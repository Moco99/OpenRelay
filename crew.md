[session]
max_retries = 2
summary_interval = 10
checkpoint_timeout = 300

[[agents]]
id = "orchestrator"
role = "planner"
mode = "api"
provider = "anthropic"
model = "claude-opus-4-5"
token_budget = 50000
checkpoints = ["plan_ready", "deviation_found"]
system_prompt_extra = ""

[[agents]]
id = "executor"
role = "coder"
mode = "cli"
cli = "claude"
model = "claude-sonnet-4-6"
token_budget = 200000
working_dir = "."
checkpoints = []
