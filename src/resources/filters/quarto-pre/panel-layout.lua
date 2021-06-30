-- panel-layout.lua
-- Copyright (C) 2021 by RStudio, PBC

function panelLayout() 

  return {
    Div = function(el)
      if (hasBootstrap()) then
        local fill = el.attr.classes:find("panel-fill")
        local center = el.attr.classes:find("panel-center")
        if fill or center then
          local layoutClass =  fill and "panel-fill" or "panel-center"
          local div = pandoc.Div({ el })
          el.attr.classes = el.attr.classes:filter(function(clz) return clz ~= layoutClass end)
          if fill then
            tappend(div.attr.classes, {
              "col",
              "col-12",
            })
          elseif center then
            tappend(div.attr.classes, {
              "col",
              "col-12",
              "col-lg-10",
              "mx-auto"
            })
          end
          -- return wrapped in a raw
          return pandoc.Div({ div }, pandoc.Attr("", { 
            layoutClass,
            "row"
          }))
        end
      end
    end
  }
  
end

