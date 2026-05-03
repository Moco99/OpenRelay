[session]
max_retries = 2
summary_interval = 10
checkpoint_timeout = 300

[[agents]]
id = "orchestrator"
role = "planner"
cli = "claude"
model = "claude-opus-4-5"
token_budget = 50000
checkpoints = ["plan_ready", "deviation_found"]

[[agents]]
id = "executor"
role = "coder"
cli = "gemini"
model = "gemini-2.5-pro"
token_budget = 200000
working_dir = "."
checkpoints = []
