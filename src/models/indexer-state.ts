import mongoose, { Document, Schema } from 'mongoose';

export interface IIndexerState extends Document {
  contractAddress: string;
  lastIndexedLedger: number;
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
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.IndexerState ||
  mongoose.model<IIndexerState>('IndexerState', indexerStateSchema);
