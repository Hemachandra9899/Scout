import { executePythonInProcess } from "./pythonSandboxCore.ts";
import type {
  PythonSandboxWorkerRequest,
  PythonSandboxWorkerResponse,
} from "./pythonSandboxWorkerProtocol.ts";

declare const self: {
  onmessage:
    | ((
        event: MessageEvent<PythonSandboxWorkerRequest>,
      ) => void)
    | null;
  postMessage(message: PythonSandboxWorkerResponse): void;
};

self.onmessage = (event) => {
  const request = event.data;

  executePythonInProcess({
    code: request.code,
    budget: request.budget,
  })
    .then((result) => {
      const response: PythonSandboxWorkerResponse = {
        id: request.id,
        ok: true,
        result: {
          ...result,
          safety: result.safety
            ? {
                ...result.safety,
                isolationMode: "worker",
              }
            : undefined,
        },
      };

      self.postMessage(response);
    })
    .catch((error) => {
      const response: PythonSandboxWorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };

      self.postMessage(response);
    });
};
