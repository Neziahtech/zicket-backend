import mongoose, { Document, Schema } from 'mongoose';

export interface IIndexerState extends Document {
  contractAddress: string;
  lastIndexedLedger: number;
  lastIndexedBlock?: number;
  updatedAt: Date;
}

const indexerStateSchema = new Schema<IIndexerState>(
  {
    contractAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    lastIndexedLedger: {
      type: Number,
      required: true,
      default: 0,
    },
    lastIndexedBlock: {
      type: Number,
    },
  },
  {
    timestamps: true,
  },
);

indexerStateSchema.post('init', function (doc) {
  if (
    (!doc.lastIndexedLedger || doc.lastIndexedLedger === 0) &&
    doc.lastIndexedBlock != null
  ) {
    doc.lastIndexedLedger = doc.lastIndexedBlock + 1;
  }
});

export default mongoose.models.IndexerState ||
  mongoose.model<IIndexerState>('IndexerState', indexerStateSchema);
