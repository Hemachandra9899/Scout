import uvicorn
import os

if __name__ == "__main__":
    port = int(os.getenv("MODEL_SERVICE_PORT", "8100"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
