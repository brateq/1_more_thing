export type ThoughtStatus = "active" | "done";

export type ThoughtPayload = {
  id: string;
  text: string;
  status: ThoughtStatus;
  createdAt: string;
  lastPresentedAt: string | null;
  completedAt: string | null;
};

export function isThought(value: unknown): value is ThoughtPayload {
  if (!value || typeof value !== "object") return false;
  const thought = value as Partial<ThoughtPayload>;
  return (
    typeof thought.id === "string" &&
    typeof thought.text === "string" &&
    (thought.status === "active" || thought.status === "done") &&
    typeof thought.createdAt === "string" &&
    (thought.lastPresentedAt === null || typeof thought.lastPresentedAt === "string") &&
    (thought.completedAt === null || typeof thought.completedAt === "string")
  );
}
