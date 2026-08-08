export const MAX_TREE_DEPTH = 32;
export const DEFAULT_MAX_INSERTION_SLOTS = 65_536;
export const MAX_INSERTION_SLOTS = 2 ** MAX_TREE_DEPTH;

export function normalizeInsertionSlotBudget(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
        throw new Error("max insertion slots must be a positive safe integer");
    }
    if (value > MAX_INSERTION_SLOTS) {
        throw new Error(`max insertion slots cannot exceed ${MAX_INSERTION_SLOTS} for depth ${MAX_TREE_DEPTH}`);
    }
    return value;
}
