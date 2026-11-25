use cairo::{Context, FillRule, LinearGradient, Operator, RadialGradient};
use serde_json::Value;

use super::path::append_commands;

const MAX_SHAPES: usize = 16;
const MAX_COMMANDS: usize = 256;

fn stop_alpha(stop: &Value) -> Result<f64, String> {
    let base = stop
        .get("alpha")
        .and_then(Value::as_f64)
        .ok_or("mask gradient stop is missing its alpha")?;
    let opacity = stop.get("opacity").and_then(Value::as_f64).unwrap_or(1.0);
    if !base.is_finite() || !(0.0..=1.0).contains(&base) {
        return Err("mask gradient stop alpha must be between 0 and 1".into());
    }
    if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
        return Err("mask gradient stop opacity must be between 0 and 1".into());
    }
    Ok(base * opacity)
}

fn set_alpha_paint(
    context: &Context,
    alpha: &Value,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let kind = alpha
        .get("type")
        .and_then(Value::as_str)
        .ok_or("mask shape alpha paint is missing its type")?;
    match kind {
        "solid" => {
            let a = alpha
                .get("alpha")
                .and_then(Value::as_f64)
                .ok_or("solid mask alpha is missing")?;
            if !a.is_finite() || !(0.0..=1.0).contains(&a) {
                return Err("solid mask alpha must be between 0 and 1".into());
            }
            // Color is irrelevant for a destination-in mask; white keeps the
            // pattern human-checkable when debugging.
            context.set_source_rgba(1.0, 1.0, 1.0, a);
        }
        "linear" => {
            let from = alpha
                .get("from")
                .ok_or("linear mask alpha is missing from")?;
            let to = alpha.get("to").ok_or("linear mask alpha is missing to")?;
            let coordinate = |value: &Value, index: usize, fallback: f64| {
                value.get(index).and_then(Value::as_f64).unwrap_or(fallback)
            };
            let local_x = |value: f64| (value - 0.5) * width;
            let local_y = |value: f64| (value - 0.5) * height;
            let gradient = LinearGradient::new(
                local_x(coordinate(from, 0, 0.0)),
                local_y(coordinate(from, 1, 0.5)),
                local_x(coordinate(to, 0, 1.0)),
                local_y(coordinate(to, 1, 0.5)),
            );
            let stops = alpha
                .get("stops")
                .and_then(Value::as_array)
                .ok_or("linear mask alpha is missing stops")?;
            if stops.is_empty() || stops.len() > 8 {
                return Err("mask alpha gradients require 1 to 8 stops".into());
            }
            let mut previous = -1.0;
            for stop in stops {
                let offset = stop
                    .get("offset")
                    .and_then(Value::as_f64)
                    .ok_or("mask gradient stop is missing its offset")?;
                if !offset.is_finite() || !(0.0..=1.0).contains(&offset) || offset < previous {
                    return Err("mask gradient stops must be ordered between 0 and 1".into());
                }
                previous = offset;
                gradient.add_color_stop_rgba(offset, 1.0, 1.0, 1.0, stop_alpha(stop)?);
            }
            context
                .set_source(&gradient)
                .map_err(|error| error.to_string())?;
        }
        "radial" => {
            let center = alpha
                .get("center")
                .ok_or("radial mask alpha is missing center")?;
            let coordinate = |value: &Value, index: usize, fallback: f64| {
                value.get(index).and_then(Value::as_f64).unwrap_or(fallback)
            };
            let cx = (coordinate(center, 0, 0.5) - 0.5) * width;
            let cy = (coordinate(center, 1, 0.5) - 0.5) * height;
            let radius = alpha
                .get("radius")
                .and_then(Value::as_f64)
                .ok_or("radial mask alpha is missing its radius")?
                * width.min(height);
            let gradient = RadialGradient::new(cx, cy, 0.0, cx, cy, radius);
            let stops = alpha
                .get("stops")
                .and_then(Value::as_array)
                .ok_or("radial mask alpha is missing stops")?;
            if stops.is_empty() || stops.len() > 8 {
                return Err("mask alpha gradients require 1 to 8 stops".into());
            }
            let mut previous = -1.0;
            for stop in stops {
                let offset = stop
                    .get("offset")
                    .and_then(Value::as_f64)
                    .ok_or("mask gradient stop is missing its offset")?;
                if !offset.is_finite() || !(0.0..=1.0).contains(&offset) || offset < previous {
                    return Err("mask gradient stops must be ordered between 0 and 1".into());
                }
                previous = offset;
                gradient.add_color_stop_rgba(offset, 1.0, 1.0, 1.0, stop_alpha(stop)?);
            }
            context
                .set_source(&gradient)
                .map_err(|error| error.to_string())?;
        }
        other => return Err(format!("unsupported mask alpha paint type: {other}")),
    }
    Ok(())
}

/// Renders the node's alpha mask into a fresh group and returns its pattern.
/// Shapes are node-box-bounded; the caller guarantees the context is clipped
/// to the node box so the temporary surface stays bounded.
pub(super) fn mask_pattern(
    context: &Context,
    mask: &Value,
    width: f64,
    height: f64,
) -> Result<cairo::Pattern, String> {
    let shapes = mask
        .get("shapes")
        .and_then(Value::as_array)
        .ok_or("node mask is missing its shapes")?;
    if shapes.is_empty() || shapes.len() > MAX_SHAPES {
        return Err("node masks require 1 to 16 shapes".into());
    }
    context.push_group();
    for shape in shapes {
        let commands = shape
            .get("commands")
            .ok_or("mask shape is missing commands")?;
        if commands.as_array().is_none() {
            return Err("mask shape commands must be an array".into());
        }
        if commands.as_array().unwrap().is_empty()
            || commands.as_array().unwrap().len() > MAX_COMMANDS
        {
            return Err("mask shapes require 1 to 256 commands".into());
        }
        append_commands(context, commands, width, height)?;
        let fill_rule = match shape
            .get("fillRule")
            .and_then(Value::as_str)
            .unwrap_or("nonzero")
        {
            "evenodd" => FillRule::EvenOdd,
            _ => FillRule::Winding,
        };
        context.set_fill_rule(fill_rule);
        let alpha = shape
            .get("alpha")
            .ok_or("mask shape is missing its alpha paint")?;
        set_alpha_paint(context, alpha, width, height)?;
        context.fill().map_err(|error| error.to_string())?;
        context.set_fill_rule(FillRule::Winding);
    }
    let pattern = context.pop_group().map_err(|error| error.to_string())?;
    Ok(pattern)
}

/// Composites the already-rendered node content with its mask:
/// node content over (for opacity) then destination-in the mask pattern.
/// The result is painted back opaque because node opacity is baked in here.
pub(super) fn composite_masked_node(
    context: &Context,
    node_pattern: &cairo::Pattern,
    mask: &Value,
    width: f64,
    height: f64,
    opacity: f64,
) -> Result<(), String> {
    let mask_pattern = mask_pattern(context, mask, width, height)?;
    context.push_group();
    context
        .set_source(node_pattern)
        .map_err(|error| error.to_string())?;
    context
        .paint_with_alpha(opacity)
        .map_err(|error| error.to_string())?;
    context
        .set_source(&mask_pattern)
        .map_err(|error| error.to_string())?;
    context.set_operator(Operator::DestIn);
    context.paint().map_err(|error| error.to_string())?;
    context.set_operator(Operator::Over);
    let combined = context.pop_group().map_err(|error| error.to_string())?;
    context
        .set_source(&combined)
        .map_err(|error| error.to_string())?;
    context.paint().map_err(|error| error.to_string())?;
    Ok(())
}
