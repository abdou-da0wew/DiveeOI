use cairo::{Context, FillRule, LineCap, LineJoin};
use serde_json::Value;

use super::{color, number, paint::set_paint};

fn point(value: &Value, key: &str, width: f64, height: f64) -> Result<(f64, f64), String> {
    let value = value
        .get(key)
        .ok_or_else(|| format!("path command is missing {key}"))?;
    let x = value
        .get(0)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("path {key} x coordinate is invalid"))?;
    let y = value
        .get(1)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("path {key} y coordinate is invalid"))?;
    if !x.is_finite() || !y.is_finite() {
        return Err(format!("path {key} coordinates must be finite"));
    }
    Ok((x - width / 2.0, y - height / 2.0))
}

pub(super) fn append_commands(
    context: &Context,
    commands: &Value,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let commands = commands
        .as_array()
        .ok_or("path commands must be an array")?;
    if commands.is_empty() || commands.len() > 256 {
        return Err("native paths require 1 to 256 commands".into());
    }
    context.new_path();
    let mut started = false;
    for command in commands {
        match command.get("type").and_then(Value::as_str).unwrap_or("") {
            "moveTo" => {
                let (x, y) = point(command, "point", width, height)?;
                context.move_to(x, y);
                started = true;
            }
            "lineTo" if started => {
                let (x, y) = point(command, "point", width, height)?;
                context.line_to(x, y);
            }
            "quadraticTo" if started => {
                let (cx, cy) = point(command, "control", width, height)?;
                let (x, y) = point(command, "to", width, height)?;
                let (sx, sy) = context.current_point().map_err(|error| error.to_string())?;
                let c1x = sx + (cx - sx) * (2.0 / 3.0);
                let c1y = sy + (cy - sy) * (2.0 / 3.0);
                let c2x = x + (cx - x) * (2.0 / 3.0);
                let c2y = y + (cy - y) * (2.0 / 3.0);
                context.curve_to(c1x, c1y, c2x, c2y, x, y);
            }
            "cubicTo" if started => {
                let (c1x, c1y) = point(command, "control1", width, height)?;
                let (c2x, c2y) = point(command, "control2", width, height)?;
                let (x, y) = point(command, "to", width, height)?;
                context.curve_to(c1x, c1y, c2x, c2y, x, y);
            }
            "close" if started => context.close_path(),
            kind => return Err(format!("invalid native path command: {kind}")),
        }
    }
    Ok(())
}

fn fill_rule(value: &Value) -> FillRule {
    match value
        .get("fillRule")
        .and_then(Value::as_str)
        .unwrap_or("nonzero")
    {
        "evenodd" => FillRule::EvenOdd,
        _ => FillRule::Winding,
    }
}

pub(super) fn clip_path(
    context: &Context,
    clip: &Value,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let commands = clip
        .get("commands")
        .ok_or("clip path is missing commands")?;
    append_commands(context, commands, width, height)?;
    context.set_fill_rule(fill_rule(clip));
    context.clip();
    context.set_fill_rule(FillRule::Winding);
    Ok(())
}

pub(super) fn draw_path(
    context: &Context,
    node: &Value,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let commands = node
        .get("commands")
        .ok_or("path node is missing its commands")?;
    append_commands(context, commands, width, height)?;
    context.set_fill_rule(fill_rule(node));
    if set_paint(context, node.get("fill"), width, height, "none")? {
        context.fill_preserve().map_err(|error| error.to_string())?;
    }
    context.set_fill_rule(FillRule::Winding);

    if let Some(stroke) = node.get("stroke").and_then(Value::as_str)
        && stroke != "none"
    {
        color(context, stroke, 1.0);
        context.set_line_width(number(node, "strokeWidth", 1.0));
        context.set_line_cap(
            match node
                .get("lineCap")
                .and_then(Value::as_str)
                .unwrap_or("butt")
            {
                "round" => LineCap::Round,
                "square" => LineCap::Square,
                _ => LineCap::Butt,
            },
        );
        context.set_line_join(
            match node
                .get("lineJoin")
                .and_then(Value::as_str)
                .unwrap_or("miter")
            {
                "round" => LineJoin::Round,
                "bevel" => LineJoin::Bevel,
                _ => LineJoin::Miter,
            },
        );
        context.stroke().map_err(|error| error.to_string())?;
    }
    Ok(())
}
