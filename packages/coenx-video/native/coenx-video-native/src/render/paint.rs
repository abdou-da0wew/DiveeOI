use cairo::{Context, LinearGradient, Matrix, RadialGradient};
use serde_json::Value;

fn component(value: &Value, key: &str) -> Result<f64, String> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("gradient stop is missing numeric {key}"))
}

fn color(value: &str) -> Result<(f64, f64, f64, f64), String> {
    let value = value.trim_start_matches('#');
    if value.len() != 6 && value.len() != 8 {
        return Err("gradient colors must use #RRGGBB or #RRGGBBAA".into());
    }
    let parsed = u32::from_str_radix(value, 16)
        .map_err(|_| "gradient stop contains an invalid hexadecimal color".to_string())?;
    let (r, g, b, a) = if value.len() == 8 {
        (
            (parsed >> 24) & 255,
            (parsed >> 16) & 255,
            (parsed >> 8) & 255,
            (parsed & 255) as f64 / 255.0,
        )
    } else {
        ((parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255, 1.0)
    };
    Ok((r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0, a))
}

fn coordinate(value: &Value, index: usize, fallback: f64) -> f64 {
    value.get(index).and_then(Value::as_f64).unwrap_or(fallback)
}

fn spread(paint: &Value) -> cairo::Extend {
    match paint.get("spread").and_then(Value::as_str) {
        Some("repeat") => cairo::Extend::Repeat,
        Some("reflect") => cairo::Extend::Reflect,
        _ => cairo::Extend::Pad,
    }
}

fn gradient_matrix(paint: &Value) -> Option<Matrix> {
    let transform = paint.get("transform")?;
    let scale = |axis: &str| {
        transform
            .get("scale")
            .and_then(|value| value.get(axis))
            .and_then(Value::as_f64)
            .unwrap_or(1.0)
    };
    let translate = |axis: &str| {
        transform
            .get("translate")
            .and_then(|value| value.get(axis))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let radians = transform
        .get("rotate")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .to_radians();
    let (cos, sin) = (radians.cos(), radians.sin());
    let sx = scale("0");
    let sy = scale("1");
    let matrix = Matrix::new(
        sx * cos,
        sx * sin,
        -sy * sin,
        sy * cos,
        translate("0"),
        translate("1"),
    );
    Some(matrix)
}

fn add_stops(gradient: &impl GradientStops, stops: &[Value]) -> Result<(), String> {
    if !(2..=8).contains(&stops.len()) {
        return Err("native gradients require 2 to 8 color stops".into());
    }
    let mut previous = -1.0;
    for stop in stops {
        let offset = component(stop, "offset")?;
        if !offset.is_finite() || !(0.0..=1.0).contains(&offset) || offset < previous {
            return Err("native gradient stops must be ordered between 0 and 1".into());
        }
        previous = offset;
        let color_value = stop
            .get("color")
            .and_then(Value::as_str)
            .ok_or("gradient stop color is required")?;
        let opacity = stop.get("opacity").and_then(Value::as_f64).unwrap_or(1.0);
        if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
            return Err("gradient stop opacity must be between 0 and 1".into());
        }
        let (r, g, b, a) = color(color_value)?;
        gradient.add(offset, r, g, b, a * opacity);
    }
    Ok(())
}

trait GradientStops {
    fn add(&self, offset: f64, r: f64, g: f64, b: f64, a: f64);
}

impl GradientStops for LinearGradient {
    fn add(&self, offset: f64, r: f64, g: f64, b: f64, a: f64) {
        self.add_color_stop_rgba(offset, r, g, b, a);
    }
}

impl GradientStops for RadialGradient {
    fn add(&self, offset: f64, r: f64, g: f64, b: f64, a: f64) {
        self.add_color_stop_rgba(offset, r, g, b, a);
    }
}

pub(super) fn set_paint(
    context: &Context,
    paint: Option<&Value>,
    width: f64,
    height: f64,
    fallback: &str,
) -> Result<bool, String> {
    let Some(paint) = paint else {
        if fallback == "none" {
            return Ok(false);
        }
        let (r, g, b, a) = color(fallback)?;
        context.set_source_rgba(r, g, b, a);
        return Ok(true);
    };
    if let Some(value) = paint.as_str() {
        if value == "none" {
            return Ok(false);
        }
        let (r, g, b, a) = color(value)?;
        context.set_source_rgba(r, g, b, a);
        return Ok(true);
    }

    let kind = paint
        .get("type")
        .and_then(Value::as_str)
        .ok_or("native gradient is missing its type")?;
    let stops = paint
        .get("stops")
        .and_then(Value::as_array)
        .ok_or("native gradient is missing its stops")?;
    let local_x = |value: f64| (value - 0.5) * width;
    let local_y = |value: f64| (value - 0.5) * height;
    match kind {
        "linear" => {
            let from = paint.get("from").ok_or("linear gradient is missing from")?;
            let to = paint.get("to").ok_or("linear gradient is missing to")?;
            let gradient = LinearGradient::new(
                local_x(coordinate(from, 0, 0.0)),
                local_y(coordinate(from, 1, 0.5)),
                local_x(coordinate(to, 0, 1.0)),
                local_y(coordinate(to, 1, 0.5)),
            );
            add_stops(&gradient, stops)?;
            gradient.set_extend(spread(paint));
            if let Some(matrix) = gradient_matrix(paint) {
                gradient.set_matrix(matrix);
            }
            context
                .set_source(&gradient)
                .map_err(|error| error.to_string())?;
        }
        "radial" => {
            let center = paint
                .get("center")
                .ok_or("radial gradient is missing center")?;
            let cx = local_x(coordinate(center, 0, 0.5));
            let cy = local_y(coordinate(center, 1, 0.5));
            let radius = paint
                .get("radius")
                .and_then(Value::as_f64)
                .ok_or("radial gradient is missing its radius")?
                * width.min(height);
            if !radius.is_finite() || radius <= 0.0 {
                return Err("radial gradient radius must be positive".into());
            }
            let gradient = RadialGradient::new(cx, cy, 0.0, cx, cy, radius);
            add_stops(&gradient, stops)?;
            gradient.set_extend(spread(paint));
            if let Some(matrix) = gradient_matrix(paint) {
                gradient.set_matrix(matrix);
            }
            context
                .set_source(&gradient)
                .map_err(|error| error.to_string())?;
        }
        _ => return Err(format!("unsupported native gradient type: {kind}")),
    }
    Ok(true)
}
