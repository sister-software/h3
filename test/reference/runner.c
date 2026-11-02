/*
 * Test-only H3 C reference runner. Never linked into a production artifact.
 *
 * Protocol: one operation per input line, whitespace-separated tokens:
 *
 *   <operation> <arg>...
 *
 * Index arguments are hexadecimal without prefix. Floating-point arguments are parsed with
 * strtod (so "nan", "inf", "-inf" and 17-digit decimals round-trip). Integer arguments are decimal.
 * Polygons are encoded as: <numLoops> then for each loop <numVerts> <lat> <lng>..., radians,
 * exterior loop first.
 *
 * Output: one line per input line:
 *
 *   <C error code> <result tokens...>
 *
 * Indexes are printed as lowercase hexadecimal (C h3ToString form), doubles with %.17g, and
 * integers in decimal. On a nonzero error only the error code is printed.
 */
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "h3api.h"

#define MAX_TOKENS 1000000

static char *tokens[MAX_TOKENS];
static int ntok, pos;

static const char *next(void) {
    if (pos >= ntok) {
        fprintf(stderr, "runner: missing argument\n");
        exit(2);
    }
    return tokens[pos++];
}
static H3Index idx(void) { return (H3Index)strtoull(next(), NULL, 16); }
static double dbl(void) { return strtod(next(), NULL); }
static long long lng_(void) { return strtoll(next(), NULL, 10); }
static int in(void) { return (int)lng_(); }

static void pidx(H3Index h) { printf(" %" PRIx64, h); }
static void pd(double d) { printf(" %.17g", d); }
static void pll(LatLng g) {
    pd(g.lat);
    pd(g.lng);
}
static void pbnd(const CellBoundary *b) {
    printf(" %d", b->numVerts);
    for (int i = 0; i < b->numVerts; i++) pll(b->verts[i]);
}

static GeoLoop *polygonLoops;
static int polygonLoopCount;

static GeoPolygon readPolygon(void) {
    GeoPolygon p;
    int loops = in();
    GeoLoop *ls = calloc(loops > 0 ? loops : 1, sizeof(GeoLoop));
    for (int l = 0; l < loops; l++) {
        ls[l].numVerts = in();
        ls[l].verts = calloc(ls[l].numVerts > 0 ? ls[l].numVerts : 1, sizeof(LatLng));
        for (int v = 0; v < ls[l].numVerts; v++) {
            ls[l].verts[v].lat = dbl();
            ls[l].verts[v].lng = dbl();
        }
    }
    p.geoloop = loops > 0 ? ls[0] : (GeoLoop){0, NULL};
    p.numHoles = loops > 0 ? loops - 1 : 0;
    p.holes = loops > 1 ? ls + 1 : NULL;
    polygonLoops = ls;
    polygonLoopCount = loops;
    return p;
}

static void freePolygon(GeoPolygon *p) {
    (void)p;
    for (int l = 0; l < polygonLoopCount; l++) free(polygonLoops[l].verts);
    free(polygonLoops);
    polygonLoops = NULL;
    polygonLoopCount = 0;
}

static int readIdxArray(H3Index **out) {
    int n = in();
    *out = calloc(n > 0 ? n : 1, sizeof(H3Index));
    for (int i = 0; i < n; i++) (*out)[i] = idx();
    return n;
}

static void printIdxArray(const H3Index *a, int64_t n, int skipNull) {
    int64_t count = 0;
    for (int64_t i = 0; i < n; i++)
        if (!skipNull || a[i]) count++;
    printf(" %" PRId64, count);
    for (int64_t i = 0; i < n; i++)
        if (!skipNull || a[i]) pidx(a[i]);
}

#define ERR(e)                \
    do {                      \
        H3Error _e = (e);     \
        if (_e) {             \
            printf("%u", _e); \
            goto done;        \
        }                     \
        printf("0");          \
    } while (0)

static void run(const char *op) {
    if (!strcmp(op, "isValidCell")) {
        printf("0 %d", isValidCell(idx()));
    } else if (!strcmp(op, "isValidIndex")) {
        printf("0 %d", isValidIndex(idx()));
    } else if (!strcmp(op, "isValidDirectedEdge")) {
        printf("0 %d", isValidDirectedEdge(idx()));
    } else if (!strcmp(op, "isValidVertex")) {
        printf("0 %d", isValidVertex(idx()));
    } else if (!strcmp(op, "isPentagon")) {
        printf("0 %d", isPentagon(idx()));
    } else if (!strcmp(op, "isResClassIII")) {
        printf("0 %d", isResClassIII(idx()));
    } else if (!strcmp(op, "getResolution")) {
        printf("0 %d", getResolution(idx()));
    } else if (!strcmp(op, "getBaseCellNumber")) {
        printf("0 %d", getBaseCellNumber(idx()));
    } else if (!strcmp(op, "getIndexDigit")) {
        H3Index h = idx();
        int r = in(), out;
        ERR(getIndexDigit(h, r, &out));
        printf(" %d", out);
    } else if (!strcmp(op, "constructCell")) {
        int res = in(), bc = in(), n = in();
        int digits[16] = {0};
        for (int i = 0; i < n && i < 16; i++) digits[i] = in();
        H3Index out;
        ERR(constructCell(res, bc, digits, &out));
        pidx(out);
    } else if (!strcmp(op, "maxFaceCount")) {
        int out;
        ERR(maxFaceCount(idx(), &out));
        printf(" %d", out);
    } else if (!strcmp(op, "getIcosahedronFaces")) {
        H3Index h = idx();
        int n;
        H3Error e = maxFaceCount(h, &n);
        int faces[5];
        if (!e) e = getIcosahedronFaces(h, faces);
        if (e) {
            printf("%u", e);
            goto done;
        }
        printf("0 %d", n);
        for (int i = 0; i < n; i++) printf(" %d", faces[i]);
    } else if (!strcmp(op, "latLngToCell")) {
        LatLng g;
        g.lat = dbl();
        g.lng = dbl();
        int res = in();
        H3Index out;
        ERR(latLngToCell(&g, res, &out));
        pidx(out);
    } else if (!strcmp(op, "cellToLatLng")) {
        LatLng g;
        ERR(cellToLatLng(idx(), &g));
        pll(g);
    } else if (!strcmp(op, "cellToBoundary")) {
        CellBoundary b;
        ERR(cellToBoundary(idx(), &b));
        pbnd(&b);
    } else if (!strcmp(op, "cellToParent")) {
        H3Index h = idx(), out;
        int r = in();
        ERR(cellToParent(h, r, &out));
        pidx(out);
    } else if (!strcmp(op, "cellToChildrenSize")) {
        H3Index h = idx();
        int r = in();
        int64_t out;
        ERR(cellToChildrenSize(h, r, &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "cellToChildren")) {
        H3Index h = idx();
        int r = in();
        int64_t n;
        H3Error e = cellToChildrenSize(h, r, &n);
        if (e) {
            printf("%u", e);
            goto done;
        }
        H3Index *out = calloc(n, sizeof(H3Index));
        e = cellToChildren(h, r, out);
        if (e) {
            printf("%u", e);
        } else {
            printf("0");
            printIdxArray(out, n, 0);
        }
        free(out);
    } else if (!strcmp(op, "cellToCenterChild")) {
        H3Index h = idx(), out;
        int r = in();
        ERR(cellToCenterChild(h, r, &out));
        pidx(out);
    } else if (!strcmp(op, "cellToChildPos")) {
        H3Index h = idx();
        int r = in();
        int64_t out;
        ERR(cellToChildPos(h, r, &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "childPosToCell")) {
        int64_t p = lng_();
        H3Index h = idx(), out;
        int r = in();
        ERR(childPosToCell(p, h, r, &out));
        pidx(out);
    } else if (!strcmp(op, "compactCells")) {
        H3Index *in_;
        int n = readIdxArray(&in_);
        H3Index *out = calloc(n > 0 ? n : 1, sizeof(H3Index));
        H3Error e = compactCells(in_, out, n);
        if (e) {
            printf("%u", e);
        } else {
            /* The full output buffer: C leaves unused trailing slots as H3_NULL. */
            printf("0");
            printIdxArray(out, n, 0);
        }
        free(in_);
        free(out);
    } else if (!strcmp(op, "uncompactCellsSize")) {
        H3Index *in_;
        int n = readIdxArray(&in_);
        int r = in();
        int64_t out;
        H3Error e = uncompactCellsSize(in_, n, r, &out);
        if (e)
            printf("%u", e);
        else
            printf("0 %" PRId64, out);
        free(in_);
    } else if (!strcmp(op, "uncompactCells")) {
        H3Index *in_;
        int n = readIdxArray(&in_);
        int r = in();
        int64_t size;
        H3Error e = uncompactCellsSize(in_, n, r, &size);
        if (e) {
            printf("%u", e);
        } else {
            H3Index *out = calloc(size > 0 ? size : 1, sizeof(H3Index));
            e = uncompactCells(in_, n, out, size, r);
            if (e) {
                printf("%u", e);
            } else {
                printf("0");
                printIdxArray(out, size, 0);
            }
            free(out);
        }
        free(in_);
    } else if (!strcmp(op, "maxGridDiskSize")) {
        int64_t out;
        ERR(maxGridDiskSize(in(), &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "gridDisk") || !strcmp(op, "gridDiskUnsafe") ||
               !strcmp(op, "gridDiskDistances") || !strcmp(op, "gridDiskDistancesUnsafe") ||
               !strcmp(op, "gridDiskDistancesSafe")) {
        H3Index h = idx();
        int k = in();
        int64_t n;
        H3Error e = maxGridDiskSize(k, &n);
        if (e) {
            printf("%u", e);
            goto done;
        }
        H3Index *out = calloc(n, sizeof(H3Index));
        int *dist = calloc(n, sizeof(int));
        int withDist = 1;
        if (!strcmp(op, "gridDisk")) {
            e = gridDisk(h, k, out);
            withDist = 0;
        } else if (!strcmp(op, "gridDiskUnsafe")) {
            e = gridDiskUnsafe(h, k, out);
            withDist = 0;
        } else if (!strcmp(op, "gridDiskDistances")) {
            e = gridDiskDistances(h, k, out, dist);
        } else if (!strcmp(op, "gridDiskDistancesUnsafe")) {
            e = gridDiskDistancesUnsafe(h, k, out, dist);
        } else {
            e = gridDiskDistancesSafe(h, k, out, dist);
        }
        if (e) {
            printf("%u", e);
        } else {
            printf("0 %" PRId64, n);
            for (int64_t i = 0; i < n; i++) {
                pidx(out[i]);
                if (withDist) printf(" %d", dist[i]);
            }
        }
        free(out);
        free(dist);
    } else if (!strcmp(op, "maxGridRingSize")) {
        int64_t out;
        ERR(maxGridRingSize(in(), &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "gridRing") || !strcmp(op, "gridRingUnsafe")) {
        H3Index h = idx();
        int k = in();
        int64_t n;
        H3Error e = maxGridRingSize(k, &n);
        if (e) {
            printf("%u", e);
            goto done;
        }
        H3Index *out = calloc(n, sizeof(H3Index));
        e = !strcmp(op, "gridRing") ? gridRing(h, k, out) : gridRingUnsafe(h, k, out);
        if (e) {
            printf("%u", e);
        } else {
            printf("0");
            printIdxArray(out, n, 0);
        }
        free(out);
    } else if (!strcmp(op, "areNeighborCells")) {
        H3Index a = idx(), b = idx();
        int out;
        ERR(areNeighborCells(a, b, &out));
        printf(" %d", out);
    } else if (!strcmp(op, "gridDistance")) {
        H3Index a = idx(), b = idx();
        int64_t out;
        ERR(gridDistance(a, b, &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "gridPathCellsSize")) {
        H3Index a = idx(), b = idx();
        int64_t out;
        ERR(gridPathCellsSize(a, b, &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "gridPathCells")) {
        H3Index a = idx(), b = idx();
        int64_t n;
        H3Error e = gridPathCellsSize(a, b, &n);
        if (e) {
            printf("%u", e);
            goto done;
        }
        H3Index *out = calloc(n > 0 ? n : 1, sizeof(H3Index));
        e = gridPathCells(a, b, out);
        if (e) {
            printf("%u", e);
        } else {
            printf("0");
            printIdxArray(out, n, 0);
        }
        free(out);
    } else if (!strcmp(op, "cellToLocalIj")) {
        H3Index a = idx(), b = idx();
        uint32_t mode = (uint32_t)lng_();
        CoordIJ out;
        ERR(cellToLocalIj(a, b, mode, &out));
        printf(" %d %d", out.i, out.j);
    } else if (!strcmp(op, "localIjToCell")) {
        H3Index a = idx();
        CoordIJ ij;
        ij.i = in();
        ij.j = in();
        uint32_t mode = (uint32_t)lng_();
        H3Index out;
        ERR(localIjToCell(a, &ij, mode, &out));
        pidx(out);
    } else if (!strcmp(op, "cellsToDirectedEdge")) {
        H3Index a = idx(), b = idx(), out;
        ERR(cellsToDirectedEdge(a, b, &out));
        pidx(out);
    } else if (!strcmp(op, "getDirectedEdgeOrigin")) {
        H3Index out;
        ERR(getDirectedEdgeOrigin(idx(), &out));
        pidx(out);
    } else if (!strcmp(op, "getDirectedEdgeDestination")) {
        H3Index out;
        ERR(getDirectedEdgeDestination(idx(), &out));
        pidx(out);
    } else if (!strcmp(op, "directedEdgeToCells")) {
        H3Index out[2];
        ERR(directedEdgeToCells(idx(), out));
        pidx(out[0]);
        pidx(out[1]);
    } else if (!strcmp(op, "originToDirectedEdges")) {
        H3Index out[6] = {0};
        ERR(originToDirectedEdges(idx(), out));
        printIdxArray(out, 6, 0);
    } else if (!strcmp(op, "directedEdgeToBoundary")) {
        CellBoundary b;
        ERR(directedEdgeToBoundary(idx(), &b));
        pbnd(&b);
    } else if (!strcmp(op, "reverseDirectedEdge")) {
        H3Index out;
        ERR(reverseDirectedEdge(idx(), &out));
        pidx(out);
    } else if (!strcmp(op, "cellToVertex")) {
        H3Index h = idx(), out;
        int v = in();
        ERR(cellToVertex(h, v, &out));
        pidx(out);
    } else if (!strcmp(op, "cellToVertexes")) {
        H3Index out[6] = {0};
        ERR(cellToVertexes(idx(), out));
        printIdxArray(out, 6, 0);
    } else if (!strcmp(op, "vertexToLatLng")) {
        LatLng g;
        ERR(vertexToLatLng(idx(), &g));
        pll(g);
    } else if (!strcmp(op, "greatCircleDistanceRads") || !strcmp(op, "greatCircleDistanceKm") ||
               !strcmp(op, "greatCircleDistanceM")) {
        LatLng a, b;
        a.lat = dbl();
        a.lng = dbl();
        b.lat = dbl();
        b.lng = dbl();
        double d = !strcmp(op, "greatCircleDistanceRads") ? greatCircleDistanceRads(&a, &b)
                   : !strcmp(op, "greatCircleDistanceKm") ? greatCircleDistanceKm(&a, &b)
                                                           : greatCircleDistanceM(&a, &b);
        printf("0");
        pd(d);
    } else if (!strcmp(op, "cellAreaRads2") || !strcmp(op, "cellAreaKm2") || !strcmp(op, "cellAreaM2")) {
        H3Index h = idx();
        double out;
        ERR(!strcmp(op, "cellAreaRads2") ? cellAreaRads2(h, &out)
            : !strcmp(op, "cellAreaKm2") ? cellAreaKm2(h, &out)
                                         : cellAreaM2(h, &out));
        pd(out);
    } else if (!strcmp(op, "edgeLengthRads") || !strcmp(op, "edgeLengthKm") || !strcmp(op, "edgeLengthM")) {
        H3Index h = idx();
        double out;
        ERR(!strcmp(op, "edgeLengthRads") ? edgeLengthRads(h, &out)
            : !strcmp(op, "edgeLengthKm") ? edgeLengthKm(h, &out)
                                          : edgeLengthM(h, &out));
        pd(out);
    } else if (!strcmp(op, "getHexagonAreaAvgKm2") || !strcmp(op, "getHexagonAreaAvgM2") ||
               !strcmp(op, "getHexagonEdgeLengthAvgKm") || !strcmp(op, "getHexagonEdgeLengthAvgM")) {
        int r = in();
        double out;
        ERR(!strcmp(op, "getHexagonAreaAvgKm2")        ? getHexagonAreaAvgKm2(r, &out)
            : !strcmp(op, "getHexagonAreaAvgM2")       ? getHexagonAreaAvgM2(r, &out)
            : !strcmp(op, "getHexagonEdgeLengthAvgKm") ? getHexagonEdgeLengthAvgKm(r, &out)
                                                       : getHexagonEdgeLengthAvgM(r, &out));
        pd(out);
    } else if (!strcmp(op, "getNumCells")) {
        int64_t out;
        ERR(getNumCells(in(), &out));
        printf(" %" PRId64, out);
    } else if (!strcmp(op, "getRes0Cells")) {
        H3Index out[122];
        ERR(getRes0Cells(out));
        printIdxArray(out, res0CellCount(), 0);
    } else if (!strcmp(op, "getPentagons")) {
        H3Index out[12];
        ERR(getPentagons(in(), out));
        printIdxArray(out, pentagonCount(), 0);
    } else if (!strcmp(op, "degsToRads")) {
        printf("0");
        pd(degsToRads(dbl()));
    } else if (!strcmp(op, "radsToDegs")) {
        printf("0");
        pd(radsToDegs(dbl()));
    } else if (!strcmp(op, "maxPolygonToCellsSize") || !strcmp(op, "maxPolygonToCellsSizeExperimental")) {
        int res = in();
        uint32_t flags = (uint32_t)lng_();
        GeoPolygon p = readPolygon();
        int64_t out;
        H3Error e = !strcmp(op, "maxPolygonToCellsSize") ? maxPolygonToCellsSize(&p, res, flags, &out)
                                                         : maxPolygonToCellsSizeExperimental(&p, res, flags, &out);
        if (e)
            printf("%u", e);
        else
            printf("0 %" PRId64, out);
        freePolygon(&p);
    } else if (!strcmp(op, "polygonToCells") || !strcmp(op, "polygonToCellsExperimental")) {
        int res = in();
        uint32_t flags = (uint32_t)lng_();
        GeoPolygon p = readPolygon();
        int experimental = !strcmp(op, "polygonToCellsExperimental");
        int64_t n;
        H3Error e = experimental ? maxPolygonToCellsSizeExperimental(&p, res, flags, &n)
                                 : maxPolygonToCellsSize(&p, res, flags, &n);
        if (e) {
            printf("%u", e);
        } else {
            H3Index *out = calloc(n > 0 ? n : 1, sizeof(H3Index));
            e = experimental ? polygonToCellsExperimental(&p, res, flags, n, out)
                             : polygonToCells(&p, res, flags, out);
            if (e) {
                printf("%u", e);
            } else {
                printf("0");
                printIdxArray(out, n, 1);
            }
            free(out);
        }
        freePolygon(&p);
    } else if (!strcmp(op, "cellsToLinkedMultiPolygon")) {
        H3Index *in_;
        int n = readIdxArray(&in_);
        LinkedGeoPolygon poly;
        H3Error e = cellsToLinkedMultiPolygon(in_, n, &poly);
        if (e) {
            printf("%u", e);
        } else {
            printf("0");
            int np = 0;
            for (LinkedGeoPolygon *p = &poly; p; p = p->next)
                if (p->first) np++;
            printf(" %d", np);
            for (LinkedGeoPolygon *p = &poly; p; p = p->next) {
                if (!p->first) continue;
                int nl = 0;
                for (LinkedGeoLoop *l = p->first; l; l = l->next) nl++;
                printf(" %d", nl);
                for (LinkedGeoLoop *l = p->first; l; l = l->next) {
                    int nv = 0;
                    for (LinkedLatLng *v = l->first; v; v = v->next) nv++;
                    printf(" %d", nv);
                    for (LinkedLatLng *v = l->first; v; v = v->next) pll(v->vertex);
                }
            }
            destroyLinkedMultiPolygon(&poly);
        }
        free(in_);
    } else {
        fprintf(stderr, "runner: unknown operation %s\n", op);
        exit(2);
    }
done:
    printf("\n");
}

int main(void) {
    static char line[1 << 24];
    while (fgets(line, sizeof line, stdin)) {
        ntok = 0;
        pos = 0;
        for (char *t = strtok(line, " \t\r\n"); t && ntok < MAX_TOKENS; t = strtok(NULL, " \t\r\n"))
            tokens[ntok++] = t;
        if (ntok == 0) continue;
        const char *op = next();
        run(op);
        fflush(stdout);
    }
    return 0;
}
