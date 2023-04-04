--[[
  A low-overhead minimal lua profiler.

  It requires cooperation from the lua interpreter itself, which we patch, and then
  compile a custom pandoc binary.
  
  In other words, this is not meant to be used by regular quarto users.
]]

local getTime = os.clock
local module = {}
local outputfile
local stack_count = 0

local onDebugHook = function(hookType)
  local no = 2
  local information = debug.getinfo(no, "nS")
  local now = os.clock()
  while information ~= nil do
    local source = information.source or "unknown"
    local name = information.name or "<C>"
    if not string.match(source, ".lua$") then
      source = "<inline>"
    end
    outputfile:write(stack_count, " ", name, " ", source, " ", information.linedefined, " ", now, " ", module.category, "\n")
    no = no + 1
    information = debug.getinfo(no, "nS")
  end
  stack_count = stack_count + 1
end

function module.start(filename)
  outputfile = io.open(filename, "a")
  if outputfile == nil then
    error("Could not open profiler.txt for writing")
    return
  end
  debug.sethook(onDebugHook, "t", 5) -- NB: "t" debugging only exists in our patched Lua interpreter/pandoc binary!
end

function module.stop()
  debug.sethook()
  outputfile:close()
end

return module
