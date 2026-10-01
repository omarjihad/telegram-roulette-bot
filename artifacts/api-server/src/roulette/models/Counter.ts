import { Schema, model } from 'mongoose';

/** Named sequences (e.g. mediation ticket numbers). */
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });

export const Counter = model('Counter', counterSchema);

export async function nextSequence(name: string, start = 1000): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: name }, [{ $set: { seq: { $add: [{ $ifNull: ['$seq', start] }, 1] } } }], {
    new: true,
    upsert: true,
  }).lean<{ seq: number }>();
  return doc!.seq;
}
