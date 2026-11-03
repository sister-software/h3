use sister_h3::{CellIndex, LatLng, raw};
fn main() {
    let cell = CellIndex::from_lat_lng(LatLng::from_degrees(37.3615593, -122.0553238), 7).unwrap();
    assert_eq!(raw::cell_to_parent(cell.get(), 9).unwrap_err().code(), 12);
    println!("{cell}");
}
