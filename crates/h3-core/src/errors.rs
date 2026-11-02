//! H3 error codes, matching C `H3ErrorCodes` numerically.

use core::fmt;

/// An H3 algorithm error. The discriminant equals the C `H3Error` value.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
#[non_exhaustive]
pub enum H3Error {
    /// The operation failed but a more specific error is not available.
    Failed = 1,
    /// Argument was outside of acceptable range.
    Domain = 2,
    /// Latitude or longitude arguments were outside of acceptable range.
    LatLngDomain = 3,
    /// Resolution argument was outside of acceptable range.
    ResDomain = 4,
    /// Cell argument was not valid.
    CellInvalid = 5,
    /// Directed edge argument was not valid.
    DirEdgeInvalid = 6,
    /// Undirected edge argument was not valid.
    UndirEdgeInvalid = 7,
    /// Vertex argument was not valid.
    VertexInvalid = 8,
    /// Pentagon distortion was encountered.
    Pentagon = 9,
    /// Duplicate input.
    DuplicateInput = 10,
    /// Cell arguments were not neighbors.
    NotNeighbors = 11,
    /// Cell arguments had incompatible resolutions.
    ResMismatch = 12,
    /// Memory allocation failed.
    MemoryAlloc = 13,
    /// Bounds of provided memory were insufficient.
    MemoryBounds = 14,
    /// Mode or flags argument was not valid.
    OptionInvalid = 15,
    /// Index argument was not valid.
    IndexInvalid = 16,
    /// Base cell number was outside of acceptable range.
    BaseCellDomain = 17,
    /// Child digits invalid.
    DigitDomain = 18,
    /// Deleted subsequence indicates invalid index.
    DeletedDigit = 19,
}

impl H3Error {
    /// The numeric C error code.
    pub const fn code(self) -> u32 {
        self as u32
    }

    /// Converts a nonzero C error code into an [`H3Error`].
    pub const fn from_code(code: u32) -> Option<H3Error> {
        Some(match code {
            1 => H3Error::Failed,
            2 => H3Error::Domain,
            3 => H3Error::LatLngDomain,
            4 => H3Error::ResDomain,
            5 => H3Error::CellInvalid,
            6 => H3Error::DirEdgeInvalid,
            7 => H3Error::UndirEdgeInvalid,
            8 => H3Error::VertexInvalid,
            9 => H3Error::Pentagon,
            10 => H3Error::DuplicateInput,
            11 => H3Error::NotNeighbors,
            12 => H3Error::ResMismatch,
            13 => H3Error::MemoryAlloc,
            14 => H3Error::MemoryBounds,
            15 => H3Error::OptionInvalid,
            16 => H3Error::IndexInvalid,
            17 => H3Error::BaseCellDomain,
            18 => H3Error::DigitDomain,
            19 => H3Error::DeletedDigit,
            _ => return None,
        })
    }

    /// The C `describeH3Error` text.
    pub const fn description(self) -> &'static str {
        match self {
            H3Error::Failed => "The operation failed but a more specific error is not available",
            H3Error::Domain => "Argument was outside of acceptable range",
            H3Error::LatLngDomain => "Latitude or longitude arguments were outside of acceptable range",
            H3Error::ResDomain => "Resolution argument was outside of acceptable range",
            H3Error::CellInvalid => "Cell argument was not valid",
            H3Error::DirEdgeInvalid => "Directed edge argument was not valid",
            H3Error::UndirEdgeInvalid => "Undirected edge argument was not valid",
            H3Error::VertexInvalid => "Vertex argument was not valid",
            H3Error::Pentagon => "Pentagon distortion was encountered",
            H3Error::DuplicateInput => "Duplicate input",
            H3Error::NotNeighbors => "Cell arguments were not neighbors",
            H3Error::ResMismatch => "Cell arguments had incompatible resolutions",
            H3Error::MemoryAlloc => "Memory allocation failed",
            H3Error::MemoryBounds => "Bounds of provided memory were insufficient",
            H3Error::OptionInvalid => "Mode or flags argument was not valid",
            H3Error::IndexInvalid => "Index argument was not valid",
            H3Error::BaseCellDomain => "Base cell number was outside of acceptable range",
            H3Error::DigitDomain => "Child digits invalid",
            H3Error::DeletedDigit => "Deleted subsequence indicates invalid index",
        }
    }
}

impl fmt::Display for H3Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.description())
    }
}

impl std::error::Error for H3Error {}

/// Result alias for H3 operations.
pub type H3Result<T> = Result<T, H3Error>;
