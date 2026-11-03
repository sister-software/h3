//! Validated indexes retain their type across traversal, geometry, and text conversion.

use sister_h3::{CellIndex, DirectedEdgeIndex, H3Error, VertexIndex, raw};
use std::collections::HashSet;

#[test]
fn typed_traversal_handles_hexagons_and_pentagons() {
    for text in ["87283472bffffff", "8009fffffffffff"] {
        let origin: CellIndex = text.parse().unwrap();
        let disk: Vec<_> = origin.disk(1).unwrap().collect();
        let ring: Vec<_> = origin.ring(1).unwrap().collect();
        assert_eq!(disk.len(), if origin.is_pentagon() { 6 } else { 7 });
        assert!(disk.contains(&origin));
        assert_eq!(ring.len(), disk.len() - 1);
        assert!(!ring.contains(&origin));
        assert_eq!(disk.iter().copied().collect::<HashSet<_>>().len(), disk.len());
        for cell in ring {
            assert!(raw::is_valid_cell(cell.get()));
            assert_eq!(origin.distance_to(cell).unwrap(), 1);
            let path: Vec<_> = origin.path_to(cell).unwrap().collect();
            assert_eq!(path, [origin, cell]);
        }
    }
}

#[test]
fn all_index_types_round_trip_through_text_and_raw_values() {
    let cell: CellIndex = "87283472bffffff".parse().unwrap();
    let neighbor = cell.ring(1).unwrap().next().unwrap();
    let edge = DirectedEdgeIndex::between(cell, neighbor).unwrap();
    let vertex = VertexIndex::of(cell, 0).unwrap();
    assert_eq!(edge.to_string().parse::<DirectedEdgeIndex>().unwrap(), edge);
    assert_eq!(vertex.to_string().parse::<VertexIndex>().unwrap(), vertex);
    assert_eq!(DirectedEdgeIndex::try_from(u64::from(edge)).unwrap(), edge);
    assert_eq!(VertexIndex::try_from(u64::from(vertex)).unwrap(), vertex);
    assert_eq!(cell.to_string().parse::<DirectedEdgeIndex>(), Err(H3Error::DirEdgeInvalid));
    assert_eq!(cell.to_string().parse::<VertexIndex>(), Err(H3Error::VertexInvalid));
    assert_eq!("invalid".parse::<DirectedEdgeIndex>(), Err(H3Error::DirEdgeInvalid));
    assert_eq!("invalid".parse::<VertexIndex>(), Err(H3Error::VertexInvalid));
    assert!(edge.length_rads().unwrap() > 0.0);
    assert!((edge.length_m().unwrap() / edge.length_km().unwrap() - 1000.0).abs() < 1e-10);
    assert!(cell.area_rads2().unwrap() > 0.0);
    assert!((cell.area_m2().unwrap() / cell.area_km2().unwrap() - 1_000_000.0).abs() < 1e-7);
}
