-- figures.lua
-- Copyright (C) 2020 by RStudio, PBC

-- constants for figure attributes
kFigAlign = "fig.align"
kFigEnv = "fig.env"
kFigPos = "fig.pos"
kFigCap = "fig.cap"
kFigScap = "fig.scap"
kResizeWidth = "resize.width"
kResizeHeight = "resize.height"


function isFigAttribute(name)
  return string.find(name, "^fig%.")
end

function figAlignAttribute(el)
  local default = pandoc.utils.stringify(
    param("fig-align", pandoc.Str("center"))
  )
  local align = attribute(el, kFigAlign, default)
  if align == "default" then
    align = default
  end
  return align
end

-- is this an image containing a figure
function isFigureImage(el)
  return hasFigureRef(el) and #el.caption > 0
end

-- is this a Div containing a figure
function isFigureDiv(el)
  if el.t == "Div" and hasFigureRef(el) then
    return refCaptionFromDiv(el) ~= nil
  else
    return discoverLinkedFigureDiv(el) ~= nil
  end
end

function discoverFigure(el, withCaption)
  if el.t ~= "Para" then
    return nil
  end
  if captionRequired == nil then
    captionRequired = true
  end
  if #el.content == 1 and el.content[1].t == "Image" then
    local image = el.content[1]
    if (withCaption and #image.caption > 0) or 
       (not withCaption and (#image.caption == 0)) then
      return image
    else
      return nil
    end
  else
    return nil
  end
end

function discoverLinkedFigure(el, withCaption)
  if el.t ~= "Para" then
    return nil
  end
  if withCaption == nil then
    withCaption = true
  end
  if #el.content == 1 then 
    if el.content[1].t == "Link" then
      local link = el.content[1]
      if #link.content == 1 and link.content[1].t == "Image" then
        local image = link.content[1]
        if (withCaption and #image.caption > 0) or 
           (not withCaption and (#image.caption == 0)) then
          return image
        end
      end
    end
  end
  return nil
end

function discoverLinkedFigureDiv(el)
  if el.t === "Div" and 
     hasFigureRef(el) and
     #el.content == 2 and 
     el.content[1].t == "Para" and 
     el.content[2].t == "Para" then
    return discoverLinkedFigure(el.content[1], false)  
  end
  return nil
end

function anonymousFigId()
  return "fig:anonymous-" .. tostring(math.random(10000000))
end

function isAnonymousFigId(identifier)
  return string.find(identifier, "^fig:anonymous-")
end


