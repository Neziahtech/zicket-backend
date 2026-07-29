import mongoose from 'mongoose';

export interface PaginationCursor {
  sortValue: Date;
  id: string;
}

interface EncodedPaginationCursor {
  sortValue: string;
  id: string;
}

export const encodePaginationCursor = (sortValue: Date, id: string): string => {
  return Buffer.from(
    JSON.stringify({
      sortValue: sortValue.toISOString(),
      id,
    }),
  ).toString('base64url');
};

export const decodePaginationCursor = (
  cursor: string,
): PaginationCursor | null => {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as Partial<EncodedPaginationCursor>;

    if (
      typeof parsed.sortValue !== 'string' ||
      typeof parsed.id !== 'string' ||
      !mongoose.Types.ObjectId.isValid(parsed.id)
    ) {
      return null;
    }

    const sortValue = new Date(parsed.sortValue);

    if (Number.isNaN(sortValue.getTime())) {
      return null;
    }

    return {
      sortValue,
      id: parsed.id,
    };
  } catch {
    return null;
  }
};
