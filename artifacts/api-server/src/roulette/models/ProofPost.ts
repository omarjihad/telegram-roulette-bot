import { Schema, model, Document } from 'mongoose';

export interface ProofMedia {
  type: 'photo' | 'video';
  // Image shown in the app (the photo, or the video's thumbnail) on Telegram's CDN.
  url: string;
}

/** A post from the public proofs channel, shown in the Mini App's proofs section. */
export interface IProofPost extends Document {
  channel: string;
  postId: number;
  date: Date | null;
  text: string;
  media: ProofMedia[];
  views: string | null;
  headlineAr: string;
  headlineEn: string;
  descAr: string;
  descEn: string;
  // Text the descriptions were made from; when the post is edited they're made again.
  describedText: string | null;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const mediaSchema = new Schema<ProofMedia>(
  { type: { type: String, enum: ['photo', 'video'], required: true }, url: { type: String, required: true } },
  { _id: false }
);

const proofPostSchema = new Schema<IProofPost>(
  {
    channel: { type: String, required: true },
    postId: { type: Number, required: true },
    date: { type: Date, default: null },
    text: { type: String, default: '' },
    media: { type: [mediaSchema], default: [] },
    views: { type: String, default: null },
    headlineAr: { type: String, default: '' },
    headlineEn: { type: String, default: '' },
    descAr: { type: String, default: '' },
    descEn: { type: String, default: '' },
    describedText: { type: String, default: null },
    hidden: { type: Boolean, default: false },
  },
  { timestamps: true }
);

proofPostSchema.index({ channel: 1, postId: -1 }, { unique: true });

export const ProofPost = model<IProofPost>('ProofPost', proofPostSchema);
