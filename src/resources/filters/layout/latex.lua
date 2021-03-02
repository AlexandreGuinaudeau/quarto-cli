-- latex.lua
-- Copyright (C) 2020 by RStudio, PBC


function latexPanel(divEl, layout, caption)
  
   -- create container
  local panel = pandoc.Div({})
 
  -- begin container
  local env, pos = latexPanelEnv(divEl, layout)
  panel.content:insert(latexBeginEnv(env, pos));
  
   -- read vertical alignment and strip attribute
  local vAlign = validatedVAlign(divEl.attr.attributes[kLayoutVAlign])
  divEl.attr.attributes[kLayoutVAlign] = nil

  for i, row in ipairs(layout) do
    
    for j, cell in ipairs(row) do
      
      -- there should never be \begin{table} inside a panel (as that would 
      -- create a nested float). this can happen if knitr injected it as a 
      -- result of a captioned latex figure. in that case remove it
      cell = latexRemoveTableDelims(cell)
      
      -- process cell (enclose content w/ alignment)
      local endOfTable = i == #layout
      local endOfRow = j == #row
      local prefix, content, suffix = latexCell(cell, vAlign, endOfRow, endOfTable)
      panel.content:insert(prefix)
      local align = cell.attr.attributes[kLayoutAlign]
      if align == "center" then
        panel.content:insert(pandoc.RawBlock("latex", latexBeginAlign(align)))
      end
      tappend(panel.content, content)
      if align == "center" then
        panel.content:insert(pandoc.RawBlock("latex", latexEndAlign(align)))
      end
      panel.content:insert(suffix)
    end
    
  end
  
  -- surround caption w/ appropriate latex (and end the panel)
  if caption then
    markupLatexCaption(divEl, caption.content)
    panel.content:insert(caption)
  end
  
  -- end latex env
  panel.content:insert(latexEndEnv(env));
  
  -- conjoin paragarphs 
  panel.content = latexJoinParas(panel.content)
 
  -- return panel
  return panel
  
end

-- determine the environment (and pos) to use for a latex panel
function latexPanelEnv(divEl, layout)
  
  -- defaults
  local env = "figure"
  local pos = nil
  
  -- explicit figure panel
  if hasFigureRef(divEl) then
    env = attribute(divEl, kFigEnv, env)
    pos = attribute(divEl, kFigPos, pos)
  -- explicit table panel
  elseif hasTableRef(divEl) then
    env = "table"
  -- if there are embedded tables then we need to use table
  else 
    local haveTables = layout:find_if(function(row)
      return row:find_if(hasTableRef)
    end)
    if haveTables then
      env = "table"
    end
  end
  
  return env, pos
  
end

-- conjoin paragraphs (allows % to work correctly between minipages or subfloats)
function latexJoinParas(content)
  local blocks = pandoc.List:new()
  for i,block in ipairs(content) do
    if block.t == "Para" and #blocks > 0 and blocks[#blocks].t == "Para" then
      tappend(blocks[#blocks].content, block.content)
    else
      blocks:insert(block)
    end
  end
  return blocks
end

function latexImageFigure(image)
  return renderLatexFigure(image, function(figure)
    
    -- make a copy of the caption and clear it
    local caption = image.caption:clone()
    tclear(image.caption)
    
    -- get align
    local align = figAlignAttribute(image)
   
    -- insert the figure without the caption
    local figurePara = pandoc.Para({
      pandoc.RawInline("latex", latexBeginAlign(align)),
      image,
      pandoc.RawInline("latex", latexEndAlign(align)),
      pandoc.RawInline("latex", "\n")
    })
    figure.content:insert(figurePara)
    
    -- return the caption inlines
    return caption
    
  end)
end

function latexDivFigure(divEl)
  
  return renderLatexFigure(divEl, function(figure)
    
     -- get align
    local align = figAlignAttribute(divEl)

    -- append everything before the caption
    local blocks = tslice(divEl.content, 1, #divEl.content - 1)
    if align == "center" then
      figure.content:insert(pandoc.RawBlock("latex", latexBeginAlign(align)))
    end
    tappend(figure.content, blocks)
    if align == "center" then
      figure.content:insert(pandoc.RawBlock("latex", latexEndAlign(align)))
    end
    
    -- return the caption
    local caption = refCaptionFromDiv(divEl)
    return caption.content
   
  end)
  
end

function renderLatexFigure(el, render)
  
  -- create container
  local figure = pandoc.Div({})
  
  -- begin the figure
  local figEnv = attribute(el, kFigEnv, "figure")
  local figPos = attribute(el, kFigPos, nil)
  figure.content:insert(latexBeginEnv(figEnv, figPos))
  
  -- fill in the body (returns the caption inlines)
  local captionInlines = render(figure)  

  -- surround caption w/ appropriate latex (and end the figure)
  if captionInlines and inlinesToString(captionInlines) ~= "" then
    markupLatexCaption(el, captionInlines)
    figure.content:insert(pandoc.Para(captionInlines))
  end
  
  -- end figure
  figure.content:insert(latexEndEnv(figEnv))
  
  -- return the figure
  return figure
  
end


function isReferenceable(figEl)
  return figEl.attr.identifier ~= "" and 
         not isAnonymousFigId(figEl.attr.identifier)
end


function markupLatexCaption(el, caption)
  
  -- caption prefix (includes \\caption macro + optional [subcap] + {)
  local captionPrefix = pandoc.List:new({
    pandoc.RawInline("latex", "\\caption")
  })
  local figScap = attribute(el, kFigScap, nil)
  if figScap then
    captionPrefix:insert(pandoc.RawInline("latex", "["))
    tappend(captionPrefix, markdownToInlines(figScap))
    captionPrefix:insert(pandoc.RawInline("latex", "]"))
  end
  captionPrefix:insert(pandoc.RawInline("latex", "{"))
  tprepend(caption, captionPrefix)
  
  -- end the caption
  caption:insert(pandoc.RawInline("latex", "}"))
end


function latexBeginAlign(align)
  if align == "center" then
    return "{\\centering "
  elseif align == "right" then
    return "\\hfill{} "      
  else
    return ""
  end
end

function latexEndAlign(align)
  if align == "center" then
    return "\n\n}"
  elseif align == "left" then
    return " \\hfill{}"
  else
    return ""
  end
end

function latexBeginEnv(env, pos)
  local beginEnv = "\\begin{" .. env .. "}"
  if pos then
    if not string.find(pos, "^%[{") then
      pos = "[" .. pos .. "]"
    end
    beginEnv = beginEnv .. pos
  end
  return pandoc.RawBlock("latex", beginEnv)
end

function latexEndEnv(env)
  return pandoc.RawBlock("latex", "\\end{" .. env .. "}")
end

function latexCell(cell, vAlign, endOfRow, endOfTable)

  -- figure out what we are dealing with
  local label = cell.attr.identifier
  local image = figureImageFromLayoutCell(cell)
  if (label == "") and image then
    label = image.attr.identifier
  end
  local isFigure = isFigureRef(label)
  local isSubRef = hasRefParent(cell) or (image and hasRefParent(image))
  local tbl = tableFromLayoutCell(cell)
  
  -- determine width 
  local width = cell.attr.attributes["width"]
  
  -- derive prefix, content, and suffix
  local prefix = pandoc.List:new()
  local content = pandoc.List:new()
  local suffix = pandoc.List:new()

  -- sub-captioned always uses \subfloat
  if isSubRef then
    
    -- lift the caption out it it's current location and onto the \subfloat
    local caption = pandoc.List:new()
    
    -- see if it's a captioned figure
    if image and #image.caption > 0 then
      caption = image.caption:clone()
      tclear(image.caption)
    elseif tbl then
      caption = pandoc.utils.blocks_to_inlines(tbl.caption.long)
      tclear(tbl.caption.long)
      if tbl.caption.short then
        tclear(tbl.caption.short)
      end
      cell.content = { latexTabular(tbl, vAlign) }
    else
      caption = refCaptionFromDiv(cell).content
      cell.content = tslice(cell.content, 1, #cell.content-1)
    end
    
    -- prefix
    latexAppend(prefix, "\\subfloat[")
    tappend(prefix, caption)
    latexAppend(prefix, "]{\\label{" .. label .. "}%")
    latexAppend(prefix, "\n")
  end
  
  -- convert to latex percent as necessary
  local percentWidth = widthToPercent(width)
  if percentWidth then
    width = string.format("%2.2f", percentWidth/100) .. "\\linewidth"
  end

  -- start the minipage
  local miniPageVAlign = latexMinipageValign(vAlign)
  latexAppend(prefix, "\\begin{minipage}" .. miniPageVAlign .. "{" .. width .. "}\n")


  -- if we aren't in a sub-ref we may need to do some special work to
  -- ensure that captions are correctly emitted
  local cellOutput = false;
  if not isSubRef then
    if image and #image.caption > 0 then
      local caption = image.caption:clone()
      markupLatexCaption(cell, caption)
      tclear(image.caption)
      content:insert(pandoc.RawBlock("latex", "\\raisebox{-\\height}{"))
      content:insert(pandoc.Para(image))
      content:insert(pandoc.RawBlock("latex", "}"))
      content:insert(pandoc.Para(caption))
      cellOutput = true
    elseif isFigure then
      local caption = refCaptionFromDiv(cell).content
      markupLatexCaption(cell, caption)
      content:insert(pandoc.RawBlock("latex", "\\raisebox{-\\height}{"))
      tappend(content, tslice(cell.content, 1, #cell.content-1))
      content:insert(pandoc.RawBlock("latex", "}"))
      content:insert(pandoc.Para(caption)) 
      cellOutput = true
    end
  end
  
  -- if we didn't find a special case then just emit everything
  if not cellOutput then
    tappend(content, cell.content)

    -- vertically align the minipage
    if miniPageVAlign == "[t]" then
      latexAppend(prefix, "\\raisebox{-\\height}{") 
      latexAppend(suffix, "}")
    end  
  end

  -- close the minipage
  latexAppend(suffix, "\\end{minipage}%")
  
  if isSubRef then
    latexAppend(suffix, "\n}")
  end
  
  latexAppend(suffix, "\n")
  if not endOfRow then
    latexAppend(suffix, "%")
  elseif not endOfTable then
    latexAppend(suffix, "\\newline")
  end
  latexAppend(suffix, "\n")
  
  -- ensure that pandoc doesn't write any nested figures
  for i,block in ipairs(content) do
    latexHandsoffFigure(block)
    content[i] = pandoc.walk_block(block, {
      Para = latexHandsoffFigure
    })
  end
  
  return pandoc.Para(prefix), content, pandoc.Para(suffix)
  
end

function latexTabular(tbl, vAlign)
  
  -- convert to simple table
  tbl = pandoc.utils.to_simple_table(tbl)
  
  -- list of inlines
  local tabular = pandoc.List:new()
  
  -- vertically align the minipage
  local tabularVAlign = latexMinipageValign(vAlign)
 
  -- caption
  if #tbl.caption > 0 then
    latexAppend(tabular, "\\caption{")
    tappend(tabular, tbl.caption)
    latexAppend(tabular, "}\n")
  end
  
  -- header
  local aligns = table.concat(tbl.aligns:map(latexTabularAlign), "")
  latexAppend(tabular, "\\begin{tabular}" .. tabularVAlign .. "{" .. aligns .. "}\n")
  latexAppend(tabular, "\\toprule\n")
  
  -- headers (optional)
  local headers = latexTabularRow(tbl.headers)
  if latexTabularRowHasContent(headers) then
    latexTabularRowAppend(tabular, headers)
    latexAppend(tabular, "\\midrule\n")
  end
  
  -- rows
  for _,row in ipairs(tbl.rows) do
    latexTabularRowAppend(tabular, latexTabularRow(row))
  end
  
  -- footer
  latexAppend(tabular, "\\bottomrule\n")
  latexAppend(tabular, "\\end{tabular}")
  
  -- return tabular
  return pandoc.Para(tabular)
  
end

function latexTabularRow(row)
  local cells = pandoc.List:new()
  for _,cell in ipairs(row) do
    cells:insert(pandoc.utils.blocks_to_inlines(cell))
  end
  return cells
end

function latexTabularRowHasContent(row)
  for _,cell in ipairs(row) do
    if #cell > 0 then
      return true
    end
  end
  return false
end

function latexTabularRowAppend(inlines, row)
  for i,cell in ipairs(row) do
    tappend(inlines, cell)
    if i < #row then
      latexAppend(inlines, " & ")
    end
  end
  latexAppend(inlines, "\\\\\n")
end

function latexTabularAlign(align)
  if align == pandoc.AlignLeft then
    return "l"
  elseif align == pandoc.AlignRight then
    return "r"
  elseif align == pandoc.AlignCenter then
    return "c"
  else
    return "l"
  end
end

function latexAppend(inlines, latex)
  inlines:insert(pandoc.RawInline("latex", latex))
end

function latexHandsoffFigure(el)
  if discoverFigure(el, false) ~= nil then
    el.content:insert(pandoc.RawInline("markdown", "<!-- -->"))
  end
end

function latexRemoveTableDelims(el)
  return pandoc.walk_block(el, {
    RawBlock = function(el)
      if isRawLatex(el) then
        el.text = el.text:gsub("\\begin{table}[^\n]*\n", "")
        el.text = el.text:gsub("\\end{table}[^\n]*\n?", "")
        return el
      end
    end
  })
end

function latexMinipageValign(vAlign) 
  if vAlign == "top" then
   return "[t]"
  elseif vAlign == "bottom" then 
    return "[b]"
  elseif vAlign == "center" then 
    return "[c]"
  else
   return ""
  end
end

