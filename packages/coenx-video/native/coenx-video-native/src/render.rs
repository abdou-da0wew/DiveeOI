use cairo::{Context, Format, ImageSurface};
mod image;
mod paint;
mod path;
#[cfg(test)]
mod tests;
mod text;

use paint::set_paint;
use serde_json::Value;
use std::fs::File;
use std::path::Path;
use text::draw_text;

fn number(value: &Value, key: &str, fallback: f64) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(fallback)
}

fn string<'a>(value: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or(fallback)
}

fn color(context: &Context, value: &str, alpha: f64) {
    let value = value.trim_start_matches('#');
    let parsed = u32::from_str_radix(value, 16).unwrap_or(0xffffff);
    let (r, g, b) = if value.len() == 8 {
        (
            ((parsed >> 24) & 255),
            ((parsed >> 16) & 255),
            ((parsed >> 8) & 255),
        )
    } else {
        ((parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255)
    };
    let a = if value.len() == 8 {
        (parsed & 255) as f64 / 255.0
    } else {
        1.0
    };
    context.set_source_rgba(
        r as f64 / 255.0,
        g as f64 / 255.0,
        b as f64 / 255.0,
        alpha * a,
    );
}

fn rounded_rect(context: &Context, x: f64, y: f64, w: f64, h: f64, radius: f64) {
    let r = radius.max(0.0).min(w.abs() / 2.0).min(h.abs() / 2.0);
    context.new_sub_path();
    context.arc(x + w - r, y + r, r, -std::f64::consts::FRAC_PI_2, 0.0);
    context.arc(x + w - r, y + h - r, r, 0.0, std::f64::consts::FRAC_PI_2);
    context.arc(
        x + r,
        y + h - r,
        r,
        std::f64::consts::FRAC_PI_2,
        std::f64::consts::PI,
    );
    context.arc(
        x + r,
        y + r,
        r,
        std::f64::consts::PI,
        3.0 * std::f64::consts::FRAC_PI_2,
    );
    context.close_path();
}

fn render_node(context: &Context, node: &Value) -> Result<(), String> {
    if node.get("visible").and_then(Value::as_bool) == Some(false) {
        return Ok(());
    }
    let x = number(node, "x", 0.0);
    let y = number(node, "y", 0.0);
    let width = number(node, "width", 0.0);
    let height = number(node, "height", 0.0);
    let opacity = number(node, "opacity", 1.0).clamp(0.0, 1.0);
    context.save().map_err(|e| e.to_string())?;
    context.translate(x, y);
    context.rotate(number(node, "rotation", 0.0).to_radians());
    context.scale(number(node, "scaleX", 1.0), number(node, "scaleY", 1.0));
    context.new_path();
    if let Some(clip_path) = node.get("clipPath") {
        path::clip_path(context, clip_path, width, height)?;
    }
    context.push_group();
    match string(node, "kind", "") {
        "rect" | "button" => {
            let is_button = string(node, "kind", "") == "button";
            rounded_rect(
                context,
                -width / 2.0,
                -height / 2.0,
                width,
                height,
                number(node, "radius", if is_button { 12.0 } else { 0.0 }),
            );
            let has_fill =
                if is_button && node.get("disabled").and_then(Value::as_bool) == Some(true) {
                    color(context, "#666666", 1.0);
                    true
                } else {
                    set_paint(
                        context,
                        node.get("fill"),
                        width,
                        height,
                        if is_button { "#315fe8" } else { "none" },
                    )?
                };
            if has_fill {
                context.fill_preserve().map_err(|e| e.to_string())?;
            }
            let stroke = string(node, "stroke", string(node, "borderColor", "none"));
            if stroke != "none" {
                color(context, stroke, 1.0);
                context.set_line_width(number(node, "strokeWidth", 1.0));
                context.stroke().map_err(|e| e.to_string())?;
            }
            if string(node, "kind", "") == "button" {
                draw_text(context, node, "", width);
            }
        }
        "ellipse" => {
            context.save().map_err(|e| e.to_string())?;
            context.scale(width / 2.0, height / 2.0);
            context.arc(0.0, 0.0, 1.0, 0.0, std::f64::consts::TAU);
            context.restore().map_err(|e| e.to_string())?;
            if set_paint(context, node.get("fill"), width, height, "none")? {
                context.fill_preserve().map_err(|e| e.to_string())?;
            }
            let stroke = string(node, "stroke", "none");
            if stroke != "none" {
                color(context, stroke, 1.0);
                context.set_line_width(number(node, "strokeWidth", 1.0));
                context.stroke().map_err(|e| e.to_string())?;
            }
        }
        "line" => {
            if let Some(points) = node.get("points").and_then(Value::as_array) {
                for (index, point) in points.iter().enumerate() {
                    let px = point.get(0).and_then(Value::as_f64).unwrap_or(0.0) - width / 2.0;
                    let py = point.get(1).and_then(Value::as_f64).unwrap_or(0.0) - height / 2.0;
                    if index == 0 {
                        context.move_to(px, py);
                    } else {
                        context.line_to(px, py);
                    }
                }
                color(context, string(node, "stroke", "#ffffff"), 1.0);
                context.set_line_width(number(node, "strokeWidth", 2.0));
                context.set_line_cap(cairo::LineCap::Round);
                context.stroke().map_err(|e| e.to_string())?;
            }
        }
        "polygon" => {
            if let Some(points) = node.get("points").and_then(Value::as_array)
                && points.len() >= 3
            {
                for (index, point) in points.iter().enumerate() {
                    let px = point.get(0).and_then(Value::as_f64).unwrap_or(0.0) - width / 2.0;
                    let py = point.get(1).and_then(Value::as_f64).unwrap_or(0.0) - height / 2.0;
                    if index == 0 {
                        context.move_to(px, py);
                    } else {
                        context.line_to(px, py);
                    }
                }
                context.close_path();
                let fill = string(node, "fill", "none");
                if fill != "none" {
                    color(context, fill, 1.0);
                    context.fill_preserve().map_err(|e| e.to_string())?;
                }
                let stroke = string(node, "stroke", "none");
                if stroke != "none" {
                    color(context, stroke, 1.0);
                    context.set_line_width(number(node, "strokeWidth", 0.8));
                    context.stroke().map_err(|e| e.to_string())?;
                } else {
                    context.new_path();
                }
            }
        }
        "image" => image::draw_image(context, node, width, height)?,
        "path" => path::draw_path(context, node, width, height)?,
        "text" => draw_text(context, node, "", width),
        "input" => {
            rounded_rect(context, -width / 2.0, -height / 2.0, width, height, 8.0);
            color(context, "#ffffff", 1.0);
            context.fill_preserve().map_err(|e| e.to_string())?;
            color(context, "#8b95a5", 1.0);
            context.set_line_width(1.0);
            context.stroke().map_err(|e| e.to_string())?;
            let mut label = node.clone();
            if let Some(object) = label.as_object_mut() {
                object.insert(
                    "text".into(),
                    Value::String(string(node, "placeholder", "").into()),
                );
                object.insert("align".into(), Value::String("left".into()));
                object.insert("color".into(), Value::String("#6b7280".into()));
            }
            context.save().map_err(|e| e.to_string())?;
            context.translate(-width / 2.0 + 12.0, 0.0);
            draw_text(context, &label, "", width - 24.0);
            context.restore().map_err(|e| e.to_string())?;
        }
        _ => {
            return Err(format!(
                "unsupported native render node: {}",
                string(node, "kind", "unknown")
            ));
        }
    }
    let pattern = context.pop_group().map_err(|e| e.to_string())?;
    context.set_source(&pattern).map_err(|e| e.to_string())?;
    context
        .paint_with_alpha(opacity)
        .map_err(|e| e.to_string())?;
    context.restore().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn render_frame(request: &Value) -> Result<Value, String> {
    let width = request
        .get("width")
        .and_then(Value::as_u64)
        .ok_or("width is required")? as i32;
    let height = request
        .get("height")
        .and_then(Value::as_u64)
        .ok_or("height is required")? as i32;
    if width < 1 || height < 1 || width > 4096 || height > 4096 {
        return Err("frame dimensions exceed native limits".into());
    }
    let output = request
        .get("output")
        .and_then(Value::as_str)
        .ok_or("output path is required")?;
    let path = Path::new(output);
    if path.extension().and_then(|v| v.to_str()) != Some("png") {
        return Err("native frame output must be PNG".into());
    }
    let surface = ImageSurface::create(Format::ARgb32, width, height).map_err(|e| e.to_string())?;
    let context = Context::new(&surface).map_err(|e| e.to_string())?;
    color(&context, string(request, "background", "#000000"), 1.0);
    context.paint().map_err(|e| e.to_string())?;
    if let Some(clip) = request.get("clipRect").and_then(Value::as_array)
        && clip.len() == 4
    {
        let x = clip[0].as_f64().unwrap_or(0.0);
        let y = clip[1].as_f64().unwrap_or(0.0);
        let w = clip[2].as_f64().unwrap_or(0.0).max(0.0);
        let h = clip[3].as_f64().unwrap_or(0.0).max(0.0);
        context.rectangle(x, y, w, h);
        context.clip();
    }
    let mut nodes = request
        .get("nodes")
        .and_then(Value::as_array)
        .cloned()
        .ok_or("nodes must be an array")?;
    nodes.sort_by(|a, b| number(a, "zIndex", 0.0).total_cmp(&number(b, "zIndex", 0.0)));
    for node in &nodes {
        render_node(&context, node)?;
    }
    surface.flush();
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    surface.write_to_png(&mut file).map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"output": output, "width": width, "height": height, "nodeCount": nodes.len()}),
    )
}
