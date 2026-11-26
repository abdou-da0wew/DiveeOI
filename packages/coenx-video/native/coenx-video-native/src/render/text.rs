use super::paint::set_paint;
use super::{number, string};
use cairo::Context;
use glib::translate::{ToGlibPtr, from_glib_full};
use pango::{Alignment, FontDescription};
use serde_json::Value;

#[link(name = "pangocairo-1.0")]
unsafe extern "C" {
    fn pango_cairo_create_layout(context: *mut cairo::ffi::cairo_t)
    -> *mut pango::ffi::PangoLayout;
    fn pango_cairo_show_layout(
        context: *mut cairo::ffi::cairo_t,
        layout: *mut pango::ffi::PangoLayout,
    );
}

pub(super) fn draw_text(
    context: &Context,
    node: &Value,
    fallback: &str,
    width: f64,
) -> Result<(), String> {
    let text = string(node, "text", fallback);
    let family = string(node, "fontFamily", "Geist");
    let weight = number(node, "fontWeight", 500.0).round() as i32;
    let size = number(node, "fontSize", 28.0);
    let layout: pango::Layout =
        unsafe { from_glib_full(pango_cairo_create_layout(context.to_raw_none())) };
    let mut description = FontDescription::from_string(family);
    description.set_weight(if weight >= 600 {
        pango::Weight::Bold
    } else {
        pango::Weight::Normal
    });
    description.set_size((size * pango::SCALE as f64) as i32);
    layout.set_font_description(Some(&description));
    layout.set_text(text);
    layout.set_width((width.max(1.0) * pango::SCALE as f64) as i32);
    layout.set_alignment(match string(node, "align", "center") {
        "left" => Alignment::Left,
        "right" => Alignment::Right,
        _ => Alignment::Center,
    });
    let (_, logical) = layout.pixel_extents();
    // Text owns its paint: the node color (or a gradient paint object) must
    // drive the glyph source instead of whatever source the previous node left.
    // Text nodes carry a color string; gradient paints fall back to node-box
    // space approximated by the layout width.
    set_paint(context, node.get("color"), width, width, "#ffffff")?;
    context.move_to(
        -width / 2.0,
        -(logical.height() as f64) / 2.0 - logical.y() as f64,
    );
    unsafe { pango_cairo_show_layout(context.to_raw_none(), layout.to_glib_none().0) };
    Ok(())
}
