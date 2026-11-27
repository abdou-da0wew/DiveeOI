// Vendored libvosk.so lives in lib/ (scripts/fetch-models.sh downloads it from the
// alphacep vosk-api release). vosk-sys emits `cargo:rustc-link-lib=dylib=vosk`;
// we only add the search path when the vendored library is present so a system
// libvosk (apt/pip) still works.
fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let lib_dir = format!("{}/lib", manifest);
    if std::path::Path::new(&lib_dir).join("libvosk.so").exists() {
        println!("cargo:rustc-link-search=native={}", lib_dir);
    }
    println!("cargo:rerun-if-changed=lib/");
}
