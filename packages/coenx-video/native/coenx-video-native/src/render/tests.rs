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
