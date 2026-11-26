use cairo::{Context, Format, ImageSurface, Operator};
use serde_json::Value;

use super::mask::set_alpha_paint;
use super::path::append_commands;

const MAX_EFFECTS: usize = 4;
const MAX_BLUR_SIGMA: f64 = 64.0;
const MAX_SHADOW_SIGMA: f64 = 32.0;
const MAX_SHADOW_OFFSET: f64 = 128.0;
const MAX_SURFACE_PIXELS: f64 = 8_388_608.0;
const MAX_GRAIN_AMOUNT: f64 = 1.0;
const MAX_GRAIN_SIZE: f64 = 8.0;
const MAX_SEED: i64 = 2_147_483_647;

enum Effect {
    Blur {
        sigma: f64,
    },
    Shadow {
        dx: f64,
        dy: f64,
        sigma: f64,
        color: (f64, f64, f64),
    },
    Adjust {
        brightness: Option<f64>,
        contrast: Option<f64>,
        saturate: Option<f64>,
        hue: Option<f64>,
    },
    Grain {
        amount: f64,
        size: f64,
        seed: i64,
    },
    Vignette {
        strength: f64,
        radius: f64,
    },
}

impl Effect {
    fn sigma(&self) -> f64 {
        match self {
            Effect::Blur { sigma } => *sigma,
            Effect::Shadow { sigma, .. } => *sigma,
            Effect::Adjust { .. } | Effect::Grain { .. } | Effect::Vignette { .. } => 0.0,
        }
    }

    fn offset(&self) -> f64 {
        match self {
            Effect::Shadow { dx, dy, .. } => dx.abs().max(dy.abs()),
            _ => 0.0,
        }
    }
}

fn number_field(effect: &Value, key: &str) -> Result<f64, String> {
    effect
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("effect is missing a finite {key}"))
}

fn parse_color(effect: &Value) -> Result<(f64, f64, f64), String> {
    let color = effect
        .get("color")
        .and_then(Value::as_str)
        .unwrap_or("#000000");
    let hex = color.trim_start_matches('#');
    if hex.len() != 6 && hex.len() != 8 {
        return Err("drop-shadow color must be #RRGGBB or #RRGGBBAA".into());
    }
    let channels =
        u32::from_str_radix(&hex[..6], 16).map_err(|_| "drop-shadow color is invalid")?;
    Ok((
        ((channels >> 16) & 255) as f64 / 255.0,
        ((channels >> 8) & 255) as f64 / 255.0,
        (channels & 255) as f64 / 255.0,
    ))
}

fn parse_effects(node: &Value) -> Result<Vec<Effect>, String> {
    let raw = match node.get("effects").and_then(Value::as_array) {
        Some(raw) if !raw.is_empty() => raw,
        _ => return Ok(Vec::new()),
    };
    if raw.len() > MAX_EFFECTS {
        return Err(format!(
            "effect chains are limited to {MAX_EFFECTS} effects"
        ));
    }
    let mut effects = Vec::with_capacity(raw.len());
    for effect in raw {
        match effect.get("type").and_then(Value::as_str).unwrap_or("") {
            "blur" => {
                let radius = number_field(effect, "radius")?;
                if !radius.is_finite() || !(0.0..=MAX_BLUR_SIGMA).contains(&radius) {
                    return Err(format!(
                        "blur radius must be between 0 and {MAX_BLUR_SIGMA}"
                    ));
                }
                effects.push(Effect::Blur { sigma: radius });
            }
            "drop-shadow" => {
                let dx = number_field(effect, "dx")?;
                let dy = number_field(effect, "dy")?;
                let radius = number_field(effect, "radius")?;
                if !dx.is_finite()
                    || dx.abs() > MAX_SHADOW_OFFSET
                    || !dy.is_finite()
                    || dy.abs() > MAX_SHADOW_OFFSET
                {
                    return Err(format!(
                        "drop-shadow offsets must be within ±{MAX_SHADOW_OFFSET}"
                    ));
                }
                if !radius.is_finite() || !(0.0..=MAX_SHADOW_SIGMA).contains(&radius) {
                    return Err(format!(
                        "drop-shadow radius must be between 0 and {MAX_SHADOW_SIGMA}"
                    ));
                }
                let color = parse_color(effect)?;
                effects.push(Effect::Shadow {
                    dx,
                    dy,
                    sigma: radius,
                    color,
                });
            }
            "color-adjust" => {
                let field = |key: &str| {
                    effect
                        .get(key)
                        .and_then(Value::as_f64)
                        .filter(|value| value.is_finite())
                };
                effects.push(Effect::Adjust {
                    brightness: field("brightness"),
                    contrast: field("contrast"),
                    saturate: field("saturate"),
                    hue: field("hueRotate"),
                });
            }
            "grain" => {
                let amount = effect
                    .get("amount")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.35);
                let size = effect
                    .get("size")
                    .and_then(Value::as_f64)
                    .unwrap_or(2.0);
                let seed = effect
                    .get("seed")
                    .and_then(Value::as_i64)
                    .unwrap_or(7);
                if !amount.is_finite() || !(0.0..=MAX_GRAIN_AMOUNT).contains(&amount) {
                    return Err(format!(
                        "grain amount must be between 0 and {MAX_GRAIN_AMOUNT}"
                    ));
                }
                if !size.is_finite() || !(1.0..=MAX_GRAIN_SIZE).contains(&size) {
                    return Err(format!(
                        "grain size must be between 1 and {MAX_GRAIN_SIZE}"
                    ));
                }
                if !(0..=MAX_SEED).contains(&seed) {
                    return Err(format!(
                        "grain seed must be between 0 and {MAX_SEED}"
                    ));
                }
                effects.push(Effect::Grain {
                    amount,
                    size,
                    seed,
                });
            }
            "vignette" => {
                let strength = effect
                    .get("strength")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.5);
                let radius = effect
                    .get("radius")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.7);
                if !strength.is_finite() || !(0.0..=1.0).contains(&strength) {
                    return Err("vignette strength must be between 0 and 1".into());
                }
                if !radius.is_finite() || !(0.0..=1.0).contains(&radius) {
                    return Err("vignette radius must be between 0 and 1".into());
                }
                effects.push(Effect::Vignette { strength, radius });
            }
            other => return Err(format!("unsupported native effect type: {other}")),
        }
    }
    Ok(effects)
}

/// Three-pass box blur (W3C feGaussianBlur approximation) on premultiplied
/// BGRA bytes. `stride` is the row length in bytes; `width`/`height` are in
/// pixels.
fn box_blur(data: &mut [u8], width: usize, height: usize, stride: usize, sigma: f64) {
    if sigma <= 0.0 || width == 0 || height == 0 {
        return;
    }
    let mut d = (sigma * 3.0 * (2.0 * std::f64::consts::PI).sqrt() / 4.0 + 0.5) as usize;
    if d.is_multiple_of(2) {
        d += 1;
    }
    d = d.max(1).min(width.max(height) * 2 + 1);
    let radius = d / 2;
    for _ in 0..3 {
        blur_pass(data, width, height, stride, radius, true);
        blur_pass(data, width, height, stride, radius, false);
    }
}

fn blur_pass(
    data: &mut [u8],
    width: usize,
    height: usize,
    stride: usize,
    radius: usize,
    horizontal: bool,
) {
    let line_count = if horizontal { height } else { width };
    let line_length = if horizontal { width } else { height };
    if line_length < 2 {
        return;
    }
    for line in 0..line_count {
        let index = move |position: usize| -> usize {
            let (x, y) = if horizontal {
                (position, line)
            } else {
                (line, position)
            };
            y * stride + x * 4
        };
        let clamp = |value: i64| -> usize { value.clamp(0, line_length as i64 - 1) as usize };
        let mut sums = [0_u64; 4];
        for offset in -(radius as i64)..=(radius as i64) {
            let base = index(clamp(offset));
            for channel in 0..4 {
                sums[channel] += u64::from(data[base + channel]);
            }
        }
        let window = (2 * radius + 1) as u64;
        let mut output = vec![0_u8; line_length * 4];
        for position in 0..line_length {
            for channel in 0..4 {
                output[position * 4 + channel] = (sums[channel] / window) as u8;
            }
            // Slide the window one pixel forward.
            let outgoing = index(clamp(position as i64 - radius as i64));
            let incoming = index(clamp(position as i64 + radius as i64 + 1));
            for channel in 0..4 {
                sums[channel] += u64::from(data[incoming + channel]);
                sums[channel] -= u64::from(data[outgoing + channel]);
            }
        }
        for position in 0..line_length {
            let base = index(position);
            data[base..base + 4].copy_from_slice(&output[position * 4..position * 4 + 4]);
        }
    }
}

/// 3x3 color matrix + offset for brightness/contrast/saturate/hue-rotate
/// composed in CSS order (all linear ops on unpremultiplied RGB).
fn color_matrix(
    brightness: Option<f64>,
    contrast: Option<f64>,
    saturate: Option<f64>,
    hue: Option<f64>,
) -> ([f64; 9], [f64; 3]) {
    let mut matrix = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let mut offset = [0.0, 0.0, 0.0];
    let apply = |matrix: &mut [f64; 9], offset: &mut [f64; 3], m: [f64; 9], o: [f64; 3]| {
        let mut next = [0.0; 9];
        for row in 0..3 {
            for column in 0..3 {
                next[row * 3 + column] = m[row * 3] * matrix[column]
                    + m[row * 3 + 1] * matrix[3 + column]
                    + m[row * 3 + 2] * matrix[6 + column];
            }
        }
        let mut translated = [0.0; 3];
        for row in 0..3 {
            translated[row] = m[row * 3] * offset[0]
                + m[row * 3 + 1] * offset[1]
                + m[row * 3 + 2] * offset[2]
                + o[row];
        }
        *matrix = next;
        *offset = translated;
    };
    if let Some(brightness) = brightness {
        apply(
            &mut matrix,
            &mut offset,
            [
                brightness, 0.0, 0.0, 0.0, brightness, 0.0, 0.0, 0.0, brightness,
            ],
            [0.0, 0.0, 0.0],
        );
    }
    if let Some(contrast) = contrast {
        let pivot = 0.5 - 0.5 * contrast;
        apply(
            &mut matrix,
            &mut offset,
            [contrast, 0.0, 0.0, 0.0, contrast, 0.0, 0.0, 0.0, contrast],
            [pivot, pivot, pivot],
        );
    }
    if let Some(saturate) = saturate {
        apply(
            &mut matrix,
            &mut offset,
            [
                0.213 + 0.787 * saturate,
                0.715 - 0.715 * saturate,
                0.072 - 0.072 * saturate,
                0.213 - 0.213 * saturate,
                0.715 + 0.285 * saturate,
                0.072 - 0.072 * saturate,
                0.213 - 0.213 * saturate,
                0.715 - 0.715 * saturate,
                0.072 + 0.928 * saturate,
            ],
            [0.0, 0.0, 0.0],
        );
    }
    if let Some(hue) = hue {
        let radians = hue * std::f64::consts::PI / 180.0;
        let cos = radians.cos();
        let sin = radians.sin();
        apply(
            &mut matrix,
            &mut offset,
            [
                0.213 + cos * 0.787 - sin * 0.213,
                0.715 - cos * 0.715 - sin * 0.715,
                0.072 - cos * 0.072 + sin * 0.928,
                0.213 - cos * 0.213 + sin * 0.143,
                0.715 + cos * 0.285 + sin * 0.14,
                0.072 - cos * 0.072 - sin * 0.283,
                0.213 - cos * 0.213 - sin * 0.787,
                0.715 - cos * 0.715 + sin * 0.715,
                0.072 + cos * 0.928 + sin * 0.072,
            ],
            [0.0, 0.0, 0.0],
        );
    }
    (matrix, offset)
}

struct AdjustAmounts {
    brightness: Option<f64>,
    contrast: Option<f64>,
    saturate: Option<f64>,
    hue: Option<f64>,
}

fn color_adjust(
    data: &mut [u8],
    stride: usize,
    width: usize,
    height: usize,
    amounts: AdjustAmounts,
) {
    let (matrix, offset) = color_matrix(
        amounts.brightness,
        amounts.contrast,
        amounts.saturate,
        amounts.hue,
    );
    let identity =
        matrix == [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0] && offset == [0.0, 0.0, 0.0];
    if identity {
        return;
    }
    for y in 0..height {
        for x in 0..width {
            let base = y * stride + x * 4;
            let alpha = data[base + 3] as f64 / 255.0;
            if alpha <= 0.0 {
                continue;
            }
            // Unpremultiply, adjust, clamp, premultiply.
            let red = data[base + 2] as f64 / 255.0 / alpha;
            let green = data[base + 1] as f64 / 255.0 / alpha;
            let blue = data[base] as f64 / 255.0 / alpha;
            let adjusted = [
                matrix[0] * red + matrix[1] * green + matrix[2] * blue + offset[0],
                matrix[3] * red + matrix[4] * green + matrix[5] * blue + offset[1],
                matrix[6] * red + matrix[7] * green + matrix[8] * blue + offset[2],
            ];
            data[base + 2] = ((adjusted[0].clamp(0.0, 1.0)) * alpha * 255.0).round() as u8;
            data[base + 1] = ((adjusted[1].clamp(0.0, 1.0)) * alpha * 255.0).round() as u8;
            data[base] = ((adjusted[2].clamp(0.0, 1.0)) * alpha * 255.0).round() as u8;
        }
    }
}

struct ShadowParams {
    dx: f64,
    dy: f64,
    sigma: f64,
    color: (f64, f64, f64),
}

fn drop_shadow(
    data: &[u8],
    stride: usize,
    width: usize,
    height: usize,
    params: ShadowParams,
) -> Vec<u8> {
    // Shadow layer: source alpha tinted with the flood color, then blurred.
    let mut shadow = data.to_vec();
    for pixel in shadow.as_chunks_mut::<4>().0 {
        let alpha = pixel[3] as f64 / 255.0;
        pixel[0] = (params.color.2 * alpha * 255.0).round() as u8;
        pixel[1] = (params.color.1 * alpha * 255.0).round() as u8;
        pixel[2] = (params.color.0 * alpha * 255.0).round() as u8;
    }
    box_blur(&mut shadow, width, height, stride, params.sigma);
    // Composite: blurred shadow (offset) over the source, premultiplied Over.
    let shift_x = params.dx.round() as i64;
    let shift_y = params.dy.round() as i64;
    let mut out = vec![0_u8; data.len()];
    for y in 0..height {
        for x in 0..width {
            let target = y * stride + x * 4;
            let shadow_x = x as i64 - shift_x;
            let shadow_y = y as i64 - shift_y;
            let mut result = [0_u64; 4];
            if shadow_x >= 0
                && shadow_y >= 0
                && (shadow_x as usize) < width
                && (shadow_y as usize) < height
            {
                let source = (shadow_y as usize) * stride + (shadow_x as usize) * 4;
                for channel in 0..4 {
                    result[channel] += u64::from(shadow[source + channel]);
                }
            }
            // Premultiplied Over with the SOURCE on top:
            // out = source + shadow * (1 - source_alpha)
            let source_alpha = data[target + 3] as f64 / 255.0;
            let keep = 1.0 - source_alpha;
            for channel in 0..4 {
                let source_value = data[target + channel] as f64 / 255.0;
                let shadow_value = result[channel] as f64 / 255.0;
                let value = source_value + shadow_value * keep;
                out[target + channel] = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
            }
        }
    }
    out
}

pub(super) struct NodeGeometry {
    pub x: f64,
    pub y: f64,
    pub rotation_degrees: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub width: f64,
    pub height: f64,
}

impl NodeGeometry {
    fn padded_bounds(&self, pad: f64) -> Result<(i32, i32, usize, usize), String> {
        let radians = self.rotation_degrees.to_radians();
        let (sin, cos) = radians.sin_cos();
        let half_x = (self.scale_x.abs() * self.width / 2.0 * cos).abs()
            + (self.scale_y.abs() * self.height / 2.0 * sin).abs();
        let half_y = (self.scale_x.abs() * self.width / 2.0 * sin).abs()
            + (self.scale_y.abs() * self.height / 2.0 * cos).abs();
        let aabb_x = (self.x - half_x - pad).floor() as i32;
        let aabb_y = (self.y - half_y - pad).floor() as i32;
        let surface_width = ((half_x + pad) * 2.0).ceil().max(1.0) as usize;
        let surface_height = ((half_y + pad) * 2.0).ceil().max(1.0) as usize;
        if (surface_width as f64) * (surface_height as f64) > MAX_SURFACE_PIXELS {
            return Err(
                "effect surface exceeds the 8,388,608 pixel temporary surface budget".into(),
            );
        }
        Ok((aabb_x, aabb_y, surface_width, surface_height))
    }
}

/// Applies the node's effect chain (and optionally its alpha mask) to the
/// already-rendered node content and paints the bounded, padded result back
/// with the node opacity. Order: content -> effects -> mask -> opacity.
pub(super) fn apply_effect_chain(
    context: &Context,
    node_pattern: &cairo::Pattern,
    node: &Value,
    geometry: &NodeGeometry,
    opacity: f64,
    mask: Option<&Value>,
) -> Result<(), String> {
    let effects = parse_effects(node)?;
    if effects.is_empty() {
        return Err("effect chain requested without any effects".into());
    }
    let sigma = effects.iter().map(Effect::sigma).fold(0.0_f64, f64::max);
    let offset = effects.iter().map(Effect::offset).fold(0.0_f64, f64::max);
    let pad = (sigma * 3.0).ceil() + offset;
    let (aabb_x, aabb_y, surface_width, surface_height) = geometry.padded_bounds(pad)?;
    let stride = surface_width * 4;

    // Rasterize the node content into the padded, node-bounded surface. The
    // popped group pattern aligns under the transform that was active when
    // the group was pushed, so replicate it plus the AABB shift.
    let mut surface =
        ImageSurface::create(Format::ARgb32, surface_width as i32, surface_height as i32)
            .map_err(|error| error.to_string())?;
    {
        let raster = Context::new(&surface).map_err(|error| error.to_string())?;
        raster.translate(-aabb_x as f64, -aabb_y as f64);
        raster.translate(geometry.x, geometry.y);
        raster.rotate(geometry.rotation_degrees.to_radians());
        raster.scale(geometry.scale_x, geometry.scale_y);
        raster
            .set_source(node_pattern)
            .map_err(|error| error.to_string())?;
        raster.paint().map_err(|error| error.to_string())?;
        surface.flush();
        // The raster context must be dropped before the pixel buffer is read:
        // surface.data() requires exclusive access.
    }

    // Extract pixels and run the chain in place.
    let mut pixels = {
        let borrowed = surface.data().map_err(|error| error.to_string())?;
        borrowed.to_vec()
    };
    for effect in &effects {
        match effect {
            Effect::Blur { sigma } => {
                box_blur(&mut pixels, surface_width, surface_height, stride, *sigma)
            }
            Effect::Adjust {
                brightness,
                contrast,
                saturate,
                hue,
            } => color_adjust(
                &mut pixels,
                stride,
                surface_width,
                surface_height,
                AdjustAmounts {
                    brightness: *brightness,
                    contrast: *contrast,
                    saturate: *saturate,
                    hue: *hue,
                },
            ),
            Effect::Shadow {
                dx,
                dy,
                sigma,
                color,
            } => {
                pixels = drop_shadow(
                    &pixels,
                    stride,
                    surface_width,
                    surface_height,
                    ShadowParams {
                        dx: *dx,
                        dy: *dy,
                        sigma: *sigma,
                        color: *color,
                    },
                );
            }
            Effect::Grain {
                amount,
                size,
                seed,
            } => {
                apply_grain(
                    &mut pixels,
                    surface_width,
                    surface_height,
                    stride,
                    *amount,
                    *size,
                    *seed,
                );
            }
            Effect::Vignette { strength, radius } => {
                apply_vignette(
                    &mut pixels,
                    surface_width,
                    surface_height,
                    stride,
                    geometry.x - f64::from(aabb_x),
                    geometry.y - f64::from(aabb_y),
                    *strength,
                    *radius,
                );
            }
        }
    }

    let result = ImageSurface::create_for_data(
        pixels,
        Format::ARgb32,
        surface_width as i32,
        surface_height as i32,
        stride as i32,
    )
    .map_err(|error| error.to_string())?;
    let compositor = Context::new(&result).map_err(|error| error.to_string())?;
    if let Some(mask) = mask {
        // Mask semantics: content outside the node box is hidden, then the
        // mask alpha multiplies the result (destination-in).
        compositor.translate(-aabb_x as f64, -aabb_y as f64);
        compositor.translate(geometry.x, geometry.y);
        compositor.rotate(geometry.rotation_degrees.to_radians());
        compositor.scale(geometry.scale_x, geometry.scale_y);
        compositor.set_operator(Operator::DestIn);
        compositor.rectangle(
            -geometry.width / 2.0,
            -geometry.height / 2.0,
            geometry.width,
            geometry.height,
        );
        compositor.set_source_rgba(1.0, 1.0, 1.0, 1.0);
        compositor.fill().map_err(|error| error.to_string())?;
        let shapes = mask
            .get("shapes")
            .and_then(Value::as_array)
            .ok_or("node mask is missing its shapes")?;
        for shape in shapes {
            let commands = shape
                .get("commands")
                .ok_or("mask shape is missing commands")?;
            append_commands(&compositor, commands, geometry.width, geometry.height)?;
            set_alpha_paint(
                &compositor,
                shape
                    .get("alpha")
                    .ok_or("mask shape is missing its alpha paint")?,
                geometry.width,
                geometry.height,
            )?;
            compositor.fill().map_err(|error| error.to_string())?;
        }
        compositor.set_operator(Operator::Over);
        result.flush();
    }

    // Paint the padded surface back in device space: reset the transform to
    // identity (the surface origin is a device-space coordinate), keeping the
    // active clip (resource clip set after the group was popped, plus any
    // frame clipRect) so the blurred output is cut exactly like the SVG
    // backends.
    context.save().map_err(|error| error.to_string())?;
    context.identity_matrix();
    context
        .set_source_surface(&result, aabb_x as f64, aabb_y as f64)
        .map_err(|error| error.to_string())?;
    context
        .paint_with_alpha(opacity)
        .map_err(|error| error.to_string())?;
    context.restore().map_err(|error| error.to_string())?;
    Ok(())
}

/// Deterministic per-index noise in [0, 1) from a splitmix64-style mixer so
/// grain is stable for a given seed and index yet shimmers across frames
/// when the pipeline injects per-frame seeds.
fn grain_noise(seed: u64, index: u64) -> f64 {
    let mut z = seed ^ index.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = z.wrapping_add(0x6D2B_79F5);
    let mut t = z;
    t = t.wrapping_mul(t ^ (t >> 15));
    t = t.wrapping_mul(t ^ (t >> 13));
    ((t ^ (t >> 16)) & 0xFFFF) as f64 / 65535.0
}

/// Film-grain finishing layer: adds signed, alpha-weighted luminance noise
/// quantized into `size`-pixel cells over the premultiplied ARGB buffer.
fn apply_grain(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    stride: usize,
    amount: f64,
    size: f64,
    seed: i64,
) {
    if amount <= 0.0 || width == 0 || height == 0 {
        return;
    }
    let cell = size.max(1.0) as usize;
    let base_seed = (seed as u64) & 0x7FFF_FFFF;
    for y in 0..height {
        for x in 0..width {
            let cell_x = (x / cell) as u64;
            let cell_y = (y / cell) as u64;
            let index = cell_y.wrapping_mul(0x1000_0000).wrapping_add(cell_x);
            let noise = grain_noise(base_seed, index) * 2.0 - 1.0;
            let offset = y * stride + x * 4;
            let alpha = pixels[offset + 3] as f64 / 255.0;
            let delta = noise * amount * alpha * 255.0;
            for channel in 0..3 {
                let value = pixels[offset + channel] as f64 + delta;
                pixels[offset + channel] = value.clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// Radial edge-darkening finishing layer centered on the node box.
fn apply_vignette(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    stride: usize,
    center_x: f64,
    center_y: f64,
    strength: f64,
    radius: f64,
) {
    if strength <= 0.0 || width == 0 || height == 0 {
        return;
    }
    let inner = ((width.min(height) as f64) / 2.0) * radius.clamp(0.0, 1.0);
    let outer = ((width as f64).hypot(height as f64) / 2.0).max(inner + 1.0);
    for y in 0..height {
        for x in 0..width {
            let dx = x as f64 + 0.5 - center_x;
            let dy = y as f64 + 0.5 - center_y;
            let distance = dx.hypot(dy);
            if distance <= inner {
                continue;
            }
            let t = ((distance - inner) / (outer - inner)).clamp(0.0, 1.0);
            let factor = 1.0 - strength * t;
            let offset = y * stride + x * 4;
            for channel in 0..3 {
                let value = pixels[offset + channel] as f64 * factor;
                pixels[offset + channel] = value.clamp(0.0, 255.0) as u8;
            }
        }
    }
}
