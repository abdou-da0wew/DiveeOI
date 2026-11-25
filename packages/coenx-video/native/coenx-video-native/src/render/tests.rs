use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_path(label: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("coenx-native-{label}-{nonce}.png"))
}

#[test]
fn writes_a_real_png_frame_with_sorted_nodes() {
    let output = unique_path("frame");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 48,
        "background": "#102030",
        "output": output,
        "nodes": [
            {"id":"top","kind":"rect","x":32,"y":24,"width":32,"height":24,"fill":"#ff0000","zIndex":2},
            {"id":"base","kind":"rect","x":32,"y":24,"width":48,"height":40,"fill":"#00ff00","zIndex":1}
        ]
    });
    let result = render_frame(&request).expect("frame render succeeds");
    assert_eq!(result["width"], 64);
    assert_eq!(result["nodeCount"], 2);
    let bytes = std::fs::read(&output).expect("PNG exists");
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    std::fs::remove_file(output).expect("temporary frame is removed");
}

#[test]
fn composites_png_assets_into_native_frames() {
    let source_path = unique_path("source");
    let output_path = unique_path("image");
    let source = ImageSurface::create(Format::ARgb32, 8, 4).expect("source surface");
    let source_context = Context::new(&source).expect("source context");
    source_context.set_source_rgba(0.9, 0.15, 0.1, 1.0);
    source_context.paint().expect("paint source pixels");
    let mut source_file = File::create(&source_path).expect("source file");
    source
        .write_to_png(&mut source_file)
        .expect("write source PNG");
    drop(source_file);

    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 48,
        "background": "#101820",
        "output": output_path,
        "nodes": [{
            "id": "photo",
            "kind": "image",
            "x": 32,
            "y": 24,
            "width": 32,
            "height": 32,
            "fit": "cover",
            "assetPath": source_path
        }]
    });
    let result = render_frame(&request).expect("image frame render succeeds");
    assert_eq!(result["nodeCount"], 1);
    let bytes = std::fs::read(&output_path).expect("rendered image frame exists");
    assert!(bytes.len() > 100);
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    std::fs::remove_file(source_path).expect("source PNG is removed");
    std::fs::remove_file(output_path).expect("output PNG is removed");
}

#[test]
fn renders_linear_and_radial_gradient_paints() {
    let output = unique_path("gradients");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 96,
        "height": 48,
        "background": "#101820",
        "output": output,
        "nodes": [
            {
                "id": "linear",
                "kind": "rect",
                "x": 24,
                "y": 24,
                "width": 44,
                "height": 40,
                "fill": {
                    "type": "linear",
                    "from": [0, 0.5],
                    "to": [1, 0.5],
                    "stops": [
                        { "offset": 0, "color": "#ef4444" },
                        { "offset": 1, "color": "#2563eb", "opacity": 0.8 }
                    ]
                }
            },
            {
                "id": "radial",
                "kind": "ellipse",
                "x": 72,
                "y": 24,
                "width": 44,
                "height": 40,
                "fill": {
                    "type": "radial",
                    "center": [0.5, 0.5],
                    "radius": 0.5,
                    "stops": [
                        { "offset": 0, "color": "#ffffff" },
                        { "offset": 1, "color": "#10b981" }
                    ]
                }
            }
        ]
    });
    let result = render_frame(&request).expect("gradient frame render succeeds");
    assert_eq!(result["nodeCount"], 2);
    let bytes = std::fs::read(&output).expect("gradient frame exists");
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    std::fs::remove_file(output).expect("gradient frame is removed");
}

#[test]
fn rasterizes_quadratic_and_cubic_vector_paths() {
    let output = unique_path("path");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 96,
        "height": 64,
        "background": "#101820",
        "output": output,
        "nodes": [{
            "id": "curve",
            "kind": "path",
            "x": 48,
            "y": 32,
            "width": 80,
            "height": 48,
            "commands": [
                { "type": "moveTo", "point": [0, 24] },
                { "type": "quadraticTo", "control": [40, -4], "to": [80, 24] },
                { "type": "cubicTo", "control1": [80, 48], "control2": [0, 48], "to": [0, 24] },
                { "type": "close" }
            ],
            "fill": {
                "type": "linear",
                "from": [0, 0.5],
                "to": [1, 0.5],
                "stops": [
                    { "offset": 0, "color": "#ef4444" },
                    { "offset": 1, "color": "#2563eb" }
                ]
            },
            "stroke": "#ffffff",
            "strokeWidth": 2,
            "lineCap": "round",
            "lineJoin": "round"
        }]
    });
    let result = render_frame(&request).expect("curved path frame render succeeds");
    assert_eq!(result["nodeCount"], 1);
    let bytes = std::fs::read(&output).expect("path frame exists");
    assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    std::fs::remove_file(output).expect("path frame is removed");
}

#[test]
fn clips_native_nodes_with_reusable_path_geometry() {
    let output = unique_path("clip");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 48,
        "background": "#101820",
        "output": output,
        "nodes": [{
            "id": "clipped",
            "kind": "rect",
            "x": 32,
            "y": 24,
            "width": 48,
            "height": 36,
            "fill": "#16a34a",
            "clipPath": {
                "fillRule": "evenodd",
                "commands": [
                    { "type": "moveTo", "point": [0, 0] },
                    { "type": "lineTo", "point": [48, 0] },
                    { "type": "lineTo", "point": [48, 36] },
                    { "type": "lineTo", "point": [0, 36] },
                    { "type": "close" },
                    { "type": "moveTo", "point": [12, 8] },
                    { "type": "lineTo", "point": [36, 8] },
                    { "type": "lineTo", "point": [36, 28] },
                    { "type": "lineTo", "point": [12, 28] },
                    { "type": "close" }
                ]
            }
        }]
    });
    render_frame(&request).expect("clipped frame render succeeds");

    let mut png = File::open(&output).expect("clipped frame exists");
    let mut surface = ImageSurface::create_from_png(&mut png).expect("clipped PNG decodes");
    let stride = surface.stride() as usize;
    let pixels = surface.data().expect("clipped pixels are readable");
    let pixel = |x: usize, y: usize| {
        let offset = y * stride + x * 4;
        &pixels[offset..offset + 4]
    };
    let inside = pixel(16, 24);
    let hole = pixel(32, 24);
    assert!(
        inside[1] > inside[0] && inside[1] > inside[2],
        "pixel inside the clip ring should be green"
    );
    assert!(
        !(hole[1] > hole[0] && hole[1] > hole[2]),
        "even-odd clip hole should retain the background"
    );
    drop(pixels);
    std::fs::remove_file(output).expect("temporary clipped frame is removed");
}

#[test]
fn rejects_oversized_and_non_png_outputs() {
    let oversized = serde_json::json!({
        "width": 8192, "height": 8192, "output": "/tmp/invalid.png", "nodes": []
    });
    assert!(render_frame(&oversized).is_err());
    let wrong_extension = serde_json::json!({
        "width": 10, "height": 10, "output": "/tmp/invalid.jpg", "nodes": []
    });
    assert!(render_frame(&wrong_extension).is_err());
}

#[test]
fn masks_native_nodes_with_alpha_gradient_masks() {
    let output = unique_path("mask");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 48,
        "background": "#101820",
        "output": output,
        "nodes": [{
            "id": "faded",
            "kind": "rect",
            "x": 32,
            "y": 24,
            "width": 48,
            "height": 32,
            "fill": "#ff0000",
            "mask": {
                "shapes": [{
                    "kind": "rect",
                    "commands": [
                        { "type": "moveTo", "point": [0, 0] },
                        { "type": "lineTo", "point": [48, 0] },
                        { "type": "lineTo", "point": [48, 32] },
                        { "type": "lineTo", "point": [0, 32] },
                        { "type": "close" }
                    ],
                    "fillRule": "nonzero",
                    "alpha": {
                        "type": "linear",
                        "from": [0, 0.5],
                        "to": [1, 0.5],
                        "stops": [
                            { "offset": 0, "alpha": 1.0 },
                            { "offset": 1, "alpha": 0.0 }
                        ]
                    }
                }]
            }
        }]
    });
    render_frame(&request).expect("masked frame render succeeds");

    let mut png = File::open(&output).expect("masked frame exists");
    let mut surface = ImageSurface::create_from_png(&mut png).expect("masked PNG decodes");
    let stride = surface.stride() as usize;
    let pixels = surface.data().expect("masked pixels are readable");
    let pixel = |x: usize, y: usize| {
        let offset = y * stride + x * 4;
        &pixels[offset..offset + 4]
    };
    let left = pixel(16, 24);
    let right = pixel(56, 24);

    // Node box spans x 8..56; the gradient mask fades alpha 1 -> 0 across it.
    // cairo ImageSurface data is little-endian ARGB32: bytes are B, G, R, A.
    assert!(
        left[2] > left[0] && left[2] > left[1] && left[3] == 255,
        "left edge should stay opaque red under the mask"
    );
    let background: [i16; 3] = [0x20, 0x18, 0x10];
    let close_to_background = |p: &[u8]| {
        (0..3).all(|index| {
            let delta = i16::from(p[index]) - background[index];
            delta.abs() <= 2
        })
    };
    assert!(
        close_to_background(right),
        "right edge should fade fully to the background under the mask"
    );
    drop(pixels);
    std::fs::remove_file(output).expect("temporary masked frame is removed");
}

#[test]
fn rejects_masks_outside_the_supported_budget() {
    let oversized_shapes = serde_json::json!({
        "width": 16, "height": 16, "output": "/tmp/invalid-mask.png",
        "nodes": [{
            "id": "bad", "kind": "rect", "x": 8, "y": 8, "width": 8, "height": 8, "fill": "#ff0000",
            "mask": { "shapes": (0..17).map(|index| {
                serde_json::json!({
                    "kind": "rect", "x": index, "y": index, "width": 1, "height": 1,
                    "fill": "#ffffff",
                    "alpha": { "type": "solid", "alpha": 1.0 }
                })
            }).collect::<Vec<_>>() }
        }]
    });
    assert!(render_frame(&oversized_shapes).is_err());
}

#[test]
fn blurs_native_node_content_beyond_its_box() {
    let output = unique_path("blur");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 48,
        "background": "#101820",
        "output": output,
        "nodes": [{
            "id": "soft",
            "kind": "rect",
            "x": 32,
            "y": 24,
            "width": 40,
            "height": 24,
            "fill": "#ff0000",
            "effects": [{ "type": "blur", "radius": 2 }]
        }]
    });
    render_frame(&request).expect("blurred frame render succeeds");

    let mut png = File::open(&output).expect("blurred frame exists");
    let mut surface = ImageSurface::create_from_png(&mut png).expect("blurred PNG decodes");
    let stride = surface.stride() as usize;
    let pixels = surface.data().expect("blurred pixels are readable");
    let pixel = |x: usize, y: usize| {
        let offset = y * stride + x * 4;
        &pixels[offset..offset + 4]
    };
    let center = pixel(32, 24);
    // Node box spans x 12..52: pixel (14, 24) is 2px inside the hard edge and
    // (10, 24) is 2px outside it. A sigma-2 blur must make both transitional
    // instead of hard background/fill colors.
    let near_inside = pixel(14, 24);
    let near_outside = pixel(10, 24);
    assert!(
        center[2] > 200 && center[3] == 255,
        "blur must keep the fill opaque at the center"
    );
    assert!(
        near_inside[2] > 60 && near_inside[2] < 250,
        "inside-edge pixel must be a blend, not the pure fill (got {:?})",
        near_inside
    );
    assert!(
        near_outside[2] > 0x10 && near_outside[2] < 200,
        "outside-edge pixel must receive blur spill (got {:?})",
        near_outside
    );
    drop(pixels);
    std::fs::remove_file(output).expect("temporary blurred frame is removed");
}

#[test]
fn renders_drop_shadows_offset_from_the_node() {
    let output = unique_path("shadow");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 64,
        "background": "#d0d0d0",
        "output": output,
        "nodes": [{
            "id": "card",
            "kind": "rect",
            "x": 32,
            "y": 28,
            "width": 24,
            "height": 24,
            "fill": "#ffffff",
            "effects": [{ "type": "drop-shadow", "dx": 0, "dy": 6, "radius": 2, "color": "#000000" }]
        }]
    });
    render_frame(&request).expect("shadow frame render succeeds");

    let mut png = File::open(&output).expect("shadow frame exists");
    let mut surface = ImageSurface::create_from_png(&mut png).expect("shadow PNG decodes");
    let stride = surface.stride() as usize;
    let pixels = surface.data().expect("shadow pixels are readable");
    let pixel = |x: usize, y: usize| {
        let offset = y * stride + x * 4;
        &pixels[offset..offset + 4]
    };
    let card = pixel(32, 28);
    // Rect spans y 16..40; the shadow shifts down 6px to 22..46. Pixel
    // (32, 44) sits under the blurred shadow; (32, 6) stays clear above it.
    let shadowed = pixel(32, 44);
    let clear = pixel(32, 6);
    assert!(card[0] > 240 && card[3] == 255, "card body must stay white");
    assert!(
        shadowed[0] < 200 && shadowed[0] > 40,
        "shadow must darken below the card without erasing it (got {:?})",
        shadowed
    );
    assert!(
        clear[0] >= 205,
        "pixel far above the card must stay background"
    );
    drop(pixels);
    std::fs::remove_file(output).expect("temporary shadow frame is removed");
}

#[test]
fn applies_color_adjustment_to_node_pixels() {
    let output = unique_path("adjust");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 48,
        "height": 32,
        "background": "#101820",
        "output": output,
        "nodes": [{
            "id": "bright",
            "kind": "rect",
            "x": 24,
            "y": 16,
            "width": 32,
            "height": 20,
            "fill": "#808080",
            "effects": [{ "type": "color-adjust", "brightness": 1.5 }]
        }]
    });
    render_frame(&request).expect("adjusted frame render succeeds");

    let mut png = File::open(&output).expect("adjusted frame exists");
    let mut surface = ImageSurface::create_from_png(&mut png).expect("adjusted PNG decodes");
    let stride = surface.stride() as usize;
    let pixels = surface.data().expect("adjusted pixels are readable");
    let offset = 24 * stride + 16 * 4;
    let center = &pixels[offset..offset + 4];
    // 0x80 grey with brightness 1.5 becomes 0xC0 on every channel.
    assert!(
        center.iter().skip(1).all(|channel| *channel >= 0xB0) && center[0] <= 0xD0,
        "brightness 1.5 must lift 0x80 grey to ~0xC0 (got {:?})",
        center
    );
    drop(pixels);
    std::fs::remove_file(output).expect("temporary adjusted frame is removed");
}

#[test]
fn composes_effects_with_alpha_masks_in_order() {
    let output = unique_path("effect-mask");
    let request = serde_json::json!({
        "op": "render_frame",
        "width": 64,
        "height": 48,
        "background": "#101820",
        "output": output,
        "nodes": [{
            "id": "faded-glow",
            "kind": "rect",
            "x": 32,
            "y": 24,
            "width": 48,
            "height": 32,
            "fill": "#ff0000",
            "effects": [{ "type": "blur", "radius": 1 }],
            "mask": {
                "shapes": [{
                    "kind": "rect",
                    "commands": [
                        { "type": "moveTo", "point": [0, 0] },
                        { "type": "lineTo", "point": [48, 0] },
                        { "type": "lineTo", "point": [48, 32] },
                        { "type": "lineTo", "point": [0, 32] },
                        { "type": "close" }
                    ],
                    "fillRule": "nonzero",
                    "alpha": {
                        "type": "linear",
                        "from": [0, 0.5],
                        "to": [1, 0.5],
                        "stops": [
                            { "offset": 0, "alpha": 1.0 },
                            { "offset": 1, "alpha": 0.0 }
                        ]
                    }
                }]
            }
        }]
    });
    render_frame(&request).expect("effect+mask frame render succeeds");

    let mut png = File::open(&output).expect("effect+mask frame exists");
    let mut surface = ImageSurface::create_from_png(&mut png).expect("effect+mask PNG decodes");
    let stride = surface.stride() as usize;
    let pixels = surface.data().expect("effect+mask pixels are readable");
    let pixel = |x: usize, y: usize| {
        let offset = y * stride + x * 4;
        &pixels[offset..offset + 4]
    };
    let left = pixel(16, 24);
    let right = pixel(56, 24);
    assert!(
        left[2] > 180 && left[3] == 255,
        "left edge must stay opaque red after effects and mask (got {:?})",
        left
    );
    let background: [i16; 3] = [0x20, 0x18, 0x10];
    let close_to_background = |p: &[u8]| {
        (0..3).all(|index| {
            let delta = i16::from(p[index]) - background[index];
            delta.abs() <= 2
        })
    };
    assert!(
        close_to_background(right),
        "right edge must fade fully to the background (mask after effects) (got {:?})",
        right
    );
    drop(pixels);
    std::fs::remove_file(output).expect("temporary effect+mask frame is removed");
}

#[test]
fn rejects_effect_chains_beyond_the_budget() {
    let oversized = serde_json::json!({
        "width": 16, "height": 16, "output": "/tmp/invalid-effects.png",
        "nodes": [{
            "id": "bad", "kind": "rect", "x": 8, "y": 8, "width": 8, "height": 8, "fill": "#ff0000",
            "effects": (0..5).map(|_| serde_json::json!({ "type": "blur", "radius": 1 })).collect::<Vec<_>>()
        }]
    });
    assert!(render_frame(&oversized).is_err());
    let unknown = serde_json::json!({
        "width": 16, "height": 16, "output": "/tmp/invalid-effects.png",
        "nodes": [{
            "id": "bad", "kind": "rect", "x": 8, "y": 8, "width": 8, "height": 8, "fill": "#ff0000",
            "effects": [{ "type": "displacement", "scale": 4 }]
        }]
    });
    assert!(render_frame(&unknown).is_err());
}
