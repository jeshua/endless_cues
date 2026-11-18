//! The native engine's QA scripts (docs/internal/native-qa/): long runs and runs on real devices, which the tests
//! (`cargo test`) do not do. Each prints one JSON object of what it found.
//!
//!   cargo run --release --example qa -- truth   [--device NAME] [--buffer N] [--loop-s S] [--stream-s S]
//!   cargo run --release --example qa -- soak    [--device NAME] [--minutes M] [--voices N]
//!   cargo run --release --example qa -- devices [--rounds N]
//!   cargo run --release --example qa -- latency [--clicks N]
//!   cargo run --release --example qa -- parity  [--write | --read-only]   (with test/native-qa/webaudio.ts)
//!
//! Build the program first (`cargo build --release`). None of these runs while the show's app is running, and none
//! plays anything on the speakers louder than −40 dB. BlackHole 2ch (a virtual device whose output comes back on its
//! input) is the device they play to; RØDE Connect Virtual is the second device, at another rate.

mod common;
mod devices;
mod latency;
mod parity;
mod soak;
mod truth;

/// The value after a flag.
pub fn arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let rest = &args[1.min(args.len())..];
    let out = match args.first().map(String::as_str) {
        Some("truth") => truth::run(rest),
        Some("soak") => soak::run(rest),
        Some("devices") => devices::run(rest),
        Some("latency") => latency::run(rest),
        Some("parity") => parity::run(rest),
        _ => {
            eprintln!("qa truth | soak | devices | latency | parity (see qa/main.rs)");
            std::process::exit(2);
        }
    };
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
