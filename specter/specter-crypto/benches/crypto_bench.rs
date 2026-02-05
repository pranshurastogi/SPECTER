//! Criterion benchmarks for SPECTER crypto: keygen, encapsulate, decapsulate, view_tag, derivation.

use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use specter_crypto::derive;
use specter_crypto::{compute_view_tag, decapsulate, encapsulate, generate_keypair};

fn bench_keygen(c: &mut Criterion) {
    let mut g = c.benchmark_group("keygen");
    g.throughput(Throughput::Elements(1));
    g.bench_function("generate_keypair", |b| {
        b.iter(|| black_box(generate_keypair()));
    });
    g.finish();
}

fn bench_encapsulate(c: &mut Criterion) {
    let keypair = generate_keypair();
    let mut g = c.benchmark_group("encapsulate");
    g.throughput(Throughput::Elements(1));
    g.bench_function("encapsulate", |b| {
        b.iter(|| black_box(encapsulate(&keypair.public)).unwrap());
    });
    g.finish();
}

fn bench_decapsulate(c: &mut Criterion) {
    let keypair = generate_keypair();
    let (ct, _ss) = encapsulate(&keypair.public).unwrap();
    let mut g = c.benchmark_group("decapsulate");
    g.throughput(Throughput::Elements(1));
    g.bench_function("decapsulate", |b| {
        b.iter(|| black_box(decapsulate(&ct, &keypair.secret)).unwrap());
    });
    g.finish();
}

fn bench_view_tag(c: &mut Criterion) {
    let keypair = generate_keypair();
    let (_ct, ss) = encapsulate(&keypair.public).unwrap();
    let ss_bytes: &[u8] = &ss[..];
    let mut g = c.benchmark_group("view_tag");
    g.throughput(Throughput::Elements(1));
    g.bench_function("compute_view_tag", |b| {
        b.iter(|| black_box(compute_view_tag(ss_bytes)));
    });
    g.finish();
}

fn bench_stealth_derivation(c: &mut Criterion) {
    let spending = generate_keypair();
    let viewing = generate_keypair();
    let (_ct, shared_secret) = encapsulate(&viewing.public).unwrap();
    let ss: &[u8] = &shared_secret[..];
    let spk = spending.public.as_bytes();
    let ssk = spending.secret.as_bytes();

    let mut g = c.benchmark_group("stealth_derivation");
    g.throughput(Throughput::Elements(1));
    g.bench_function("derive_stealth_address", |b| {
        b.iter(|| black_box(derive::derive_stealth_address(spk, ss)).unwrap());
    });
    g.bench_function("derive_stealth_keys", |b| {
        b.iter(|| black_box(derive::derive_stealth_keys(spk, ssk, ss)).unwrap());
    });
    g.finish();
}

criterion_group!(
    benches,
    bench_keygen,
    bench_encapsulate,
    bench_decapsulate,
    bench_view_tag,
    bench_stealth_derivation
);
criterion_main!(benches);
