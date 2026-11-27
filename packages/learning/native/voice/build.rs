// Vendored libvosk.so lives in lib/ (scripts/fetch-models.sh downloads it from the
// alphacep vosk-api release). vosk-sys emits `cargo:rustc-link-lib=dylib=vosk`;
// we only add the search path when the vendored library is present so a system
// libvosk (apt/pip) still works.
fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let lib_dir = format!("{}/lib", manifest);
    if std::path::Path::new(&lib_dir).join("libvosk.so").exists() {
        println!("cargo:rustc-link-search=native={}", lib_dir);
        // Bake an $ORIGIN-relative rpath so the binary finds libvosk.so at
        // runtime without LD_LIBRARY_PATH (binary sits in target/release/,
        // the vendored lib two levels up).
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../../lib");
    }
    println!("cargo:rerun-if-changed=lib/");
}
