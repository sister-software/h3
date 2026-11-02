/*
 * C reference benchmark for `yarn benchmark`: the same workloads as
 * crates/h3-core/examples/bench.rs, against the pinned H3 C library. Test-only.
 */
#define _POSIX_C_SOURCE 199309L
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#include "h3api.h"

static uint64_t s = 0x51574833;
static double next(void) {
    s += 0x9e3779b97f4a7c15ULL;
    uint64_t z = s;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return (double)((z ^ (z >> 31)) >> 11) / (double)(1ULL << 53);
}

static double now(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1e9 + t.tv_nsec;
}

#define N 10000
static LatLng pts[N];
static H3Index cells[N];
static volatile uint64_t sink;

typedef uint64_t (*work_fn)(void);
static uint64_t w_latLngToCell(void) { uint64_t a = 0; H3Index h; for (int i = 0; i < N; i++) { latLngToCell(&pts[i], 9, &h); a += h; } return a; }
static uint64_t w_cellToParent(void) { uint64_t a = 0; H3Index h; for (int i = 0; i < N; i++) { cellToParent(cells[i], 5, &h); a += h; } return a; }
static uint64_t w_cellToLatLng(void) { uint64_t a = 0; LatLng g; for (int i = 0; i < N; i++) { cellToLatLng(cells[i], &g); union { double d; uint64_t u; } x = {g.lat}; a += x.u; } return a; }
static uint64_t w_gridDisk(void) {
    uint64_t a = 0; H3Index out[19];
    for (int i = 0; i < 1000; i++) { for (int j = 0; j < 19; j++) out[j] = 0; gridDisk(cells[i], 2, out); for (int j = 0; j < 19; j++) a += out[j]; }
    return a;
}
static H3Index *compactIn; static int64_t compactN;
static uint64_t w_compactCells(void) {
    H3Index *out = calloc(compactN, sizeof(H3Index)); uint64_t a = 0;
    compactCells(compactIn, out, compactN);
    for (int64_t i = 0; i < compactN; i++) a += out[i];
    free(out); return a;
}
static LatLng sfVerts[] = {{0.659966917655, -2.1364398519396}, {0.6595011102219, -2.1359434279405}, {0.6583348114025, -2.1354884206045},
                           {0.6581220034068, -2.1382437718946}, {0.6594479998527, -2.1384597563896}, {0.6599990002976, -2.1376771158464}};
static uint64_t w_polygonToCells(void) {
    GeoPolygon p = {.geoloop = {.numVerts = 6, .verts = sfVerts}, .numHoles = 0};
    int64_t n; maxPolygonToCellsSize(&p, 9, 0, &n);
    H3Index *out = calloc(n, sizeof(H3Index)); polygonToCells(&p, 9, 0, out);
    uint64_t a = 0; for (int64_t i = 0; i < n; i++) a += out[i];
    free(out); return a;
}

static void sample(const char *name, int samples, int ops, work_fn f) {
    uint64_t checksum = 0;
    for (int i = 0; i < 3; i++) checksum += f();
    printf("{\"op\":\"%s\",\"nsPerOp\":[", name);
    for (int i = 0; i < samples; i++) {
        double t = now();
        checksum += f();
        printf("%s%.2f", i ? "," : "", (now() - t) / ops);
    }
    sink = checksum;
    printf("],\"checksum\":\"%" PRIx64 "\"}\n", checksum);
}

int main(int argc, char **argv) {
    int samples = argc > 1 ? atoi(argv[1]) : 15;
    for (int i = 0; i < N; i++) {
        double lat = next() * 160.0 - 80.0, lng = next() * 360.0 - 180.0;
        pts[i].lat = degsToRads(lat);
        pts[i].lng = degsToRads(lng);
        latLngToCell(&pts[i], 9, &cells[i]);
    }
    H3Index parent5; cellToParent(cells[0], 5, &parent5);
    cellToChildrenSize(parent5, 9, &compactN);
    compactIn = calloc(compactN, sizeof(H3Index));
    cellToChildren(parent5, 9, compactIn);
    sample("latLngToCell", samples, N, w_latLngToCell);
    sample("cellToParent", samples, N, w_cellToParent);
    sample("cellToLatLng", samples, N, w_cellToLatLng);
    sample("gridDisk", samples, 1000, w_gridDisk);
    sample("compactCells", samples, 1, w_compactCells);
    sample("polygonToCells", samples, 1, w_polygonToCells);
    return 0;
}
