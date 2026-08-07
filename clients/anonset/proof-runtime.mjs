import {
    generateProof as generateSemaphoreProof,
    verifyProof as verifySemaphoreProof,
} from "@semaphore-protocol/proof";

let proofQueue = Promise.resolve();

async function runWithCurveCleanup(operation) {
    const execute = async () => {
        try {
            return await operation();
        } finally {
            // snarkjs/ffjavascript caches the multithreaded bn128 curve here.
            // Semaphore 4.14.3 does not terminate it after proof operations.
            const curve = globalThis.curve_bn128;
            if (curve && typeof curve.terminate === "function") {
                await curve.terminate();
            }
        }
    };

    const result = proofQueue.then(execute, execute);
    proofQueue = result.then(() => undefined, () => undefined);
    return result;
}

export function generateProof(...arguments_) {
    return runWithCurveCleanup(() => generateSemaphoreProof(...arguments_));
}

export function verifyProof(...arguments_) {
    return runWithCurveCleanup(() => verifySemaphoreProof(...arguments_));
}
