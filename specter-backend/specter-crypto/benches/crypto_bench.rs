use criterion::{black_box, criterion_group, criterion_main, Criterion};
use specter_crypto::*;

fn bench_kyber_keygen(c: &mut Criterion) {
    c.bench_function("kyber_keygen", |b| {
        b.iter(|| {
            black_box(generate_keypair());
        });
    });
}

fn bench_kyber_encapsulate(c: &mut Criterion) {
    let keypair = generate_keypair();
    
    c.bench_function("kyber_encapsulate", |b| {
        b.iter(|| {
            black_box(encapsulate(&keypair.public));
        });
    });
}

fn bench_kyber_decapsulate(c: &mut Criterion) {
    let keypair = generate_keypair();
    let (ciphertext, _) = encapsulate(&keypair.public);
    
    c.bench_function("kyber_decapsulate", |b| {
        b.iter(|| {
            black_box(decapsulate(&ciphertext, &keypair.secret).unwrap());
        });
    });
}

criterion_group!(benches, bench_kyber_keygen, bench_kyber_encapsulate, bench_kyber_decapsulate);
criterion_main!(benches);