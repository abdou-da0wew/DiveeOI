use cairo::{Context, ImageSurface};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufReader, Read};

const MAX_IMAGE_EDGE: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 16_777_216;
const CACHE_BUDGET: usize = 128 * 1024 * 1024;
const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];

#[derive(Default)]
struct ImageCache {
    entries: HashMap<String, (ImageSurface, usize)>,
    order: VecDeque<String>,
    bytes: usize,
}

impl ImageCache {
    fn get(&mut self, key: &str) -> Option<ImageSurface> {
        let (surface, _) = self.entries.get(key)?;
        let surface = surface.clone();
        self.order.retain(|entry| entry != key);
        self.order.push_back(key.to_owned());
        Some(surface)
    }

    fn insert(&mut self, key: String, surface: ImageSurface, bytes: usize) {
        if bytes > CACHE_BUDGET {
            return;
        }
        while self.bytes + bytes > CACHE_BUDGET {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some((_, removed)) = self.entries.remove(&oldest) {
                self.bytes = self.bytes.saturating_sub(removed);
            }
        }
        if let Some((_, previous)) = self.entries.remove(&key) {
            self.bytes = self.bytes.saturating_sub(previous);
            self.order.retain(|entry| entry != &key);
        }
        self.bytes += bytes;
        self.order.push_back(key.clone());
        self.entries.insert(key, (surface, bytes));
    }
}

thread_local! {
    static IMAGE_CACHE: RefCell<ImageCache> = RefCell::new(ImageCache::default());
}

fn png_dimensions(file: &mut File, path: &str) -> Result<(u32, u32), String> {
    let mut header = [0_u8; 24];
    file.read_exact(&mut header)
        .map_err(|error| format!("cannot read PNG header for {path}: {error}"))?;
    if header[..8] != PNG_SIGNATURE || &header[12..16] != b"IHDR" {
        return Err(format!("native image is not a valid PNG: {path}"));
    }
    let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
    let pixels = u64::from(width) * u64::from(height);
    if width == 0
        || height == 0
        || width > MAX_IMAGE_EDGE
        || height > MAX_IMAGE_EDGE
        || pixels > MAX_IMAGE_PIXELS
    {
        return Err(format!(
            "native image dimensions exceed the 16 MP decode limit: {path}"
        ));
    }
    Ok((width, height))
}

fn load_image(path: &str) -> Result<ImageSurface, String> {
    if let Some(surface) = IMAGE_CACHE.with(|cache| cache.borrow_mut().get(path)) {
        return Ok(surface);
    }
    let file =
        File::open(path).map_err(|error| format!("cannot open native image {path}: {error}"))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if metadata.len() == 0 || metadata.len() > MAX_SOURCE_BYTES {
        return Err(format!(
            "native PNG exceeds the 128 MB source limit: {path}"
        ));
    }
    let mut header_file = File::open(path).map_err(|error| error.to_string())?;
    let (width, height) = png_dimensions(&mut header_file, path)?;
    let surface = ImageSurface::create_from_png(&mut BufReader::new(file))
        .map_err(|error| format!("cannot decode native PNG {path}: {error}"))?;
    if surface.width() != width as i32 || surface.height() != height as i32 {
        return Err(format!(
            "native PNG dimensions changed while decoding: {path}"
        ));
    }
    let bytes = (surface.stride() as usize).saturating_mul(height as usize);
    IMAGE_CACHE.with(|cache| {
        cache
            .borrow_mut()
            .insert(path.to_owned(), surface.clone(), bytes)
    });
    Ok(surface)
}

pub(super) fn draw_image(
    context: &Context,
    node: &Value,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if width <= 0.0 || height <= 0.0 {
        return Ok(());
    }
    let path = node
        .get("assetPath")
        .and_then(Value::as_str)
        .ok_or("native image node is missing its prepared assetPath")?;
    let surface = load_image(path)?;
    let source_width = surface.width() as f64;
    let source_height = surface.height() as f64;
    let fit = node.get("fit").and_then(Value::as_str).unwrap_or("contain");
    let (draw_width, draw_height) = match fit {
        "fill" => (width, height),
        "cover" => {
            let scale = (width / source_width).max(height / source_height);
            (source_width * scale, source_height * scale)
        }
        _ => {
            let scale = (width / source_width).min(height / source_height);
            (source_width * scale, source_height * scale)
        }
    };

    context.save().map_err(|error| error.to_string())?;
    context.rectangle(-width / 2.0, -height / 2.0, width, height);
    context.clip();
    context.translate(-draw_width / 2.0, -draw_height / 2.0);
    context.scale(draw_width / source_width, draw_height / source_height);
    context
        .set_source_surface(&surface, 0.0, 0.0)
        .map_err(|error| error.to_string())?;
    context.paint().map_err(|error| error.to_string())?;
    context.restore().map_err(|error| error.to_string())?;
    Ok(())
}
