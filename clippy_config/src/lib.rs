#![feature(rustc_private, array_windows, let_chains)]
#![warn(
    trivial_casts,
    trivial_numeric_casts,
    rust_2018_idioms,
    unused_lifetimes,
    unused_qualifications
)]
#![allow(
    clippy::must_use_candidate,
    clippy::missing_panics_doc,
    rustc::diagnostic_outside_of_impl,
    rustc::untranslatable_diagnostic
)]

extern crate rustc_ast;
extern crate rustc_attr;
extern crate rustc_data_structures;
#[allow(unused_extern_crates)]
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_session;
extern crate rustc_span;

mod conf;
mod metadata;
pub mod msrvs;
pub mod types;

pub use conf::{get_configuration_metadata, lookup_conf_file, Conf};
pub use metadata::ClippyConfiguration;
