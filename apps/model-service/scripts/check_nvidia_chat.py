import os
import sys


def main() -> int:
    try:
        import pydantic
        import langchain_core
        from langchain_nvidia_ai_endpoints import ChatNVIDIA

        print(f"pydantic={pydantic.__version__}")
        print(f"langchain_core={langchain_core.__version__}")

        model = os.environ.get("NVIDIA_CODER_MODEL", "meta/llama-3.3-70b-instruct")
        llm = ChatNVIDIA(model=model)

        print(f"ChatNVIDIA construct ok: {model}")
        print(f"llm={type(llm).__name__}")
        return 0
    except Exception as exc:
        print("ChatNVIDIA compatibility check failed:", repr(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
