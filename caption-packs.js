export const captionPacks = [
  {
    "id": "jerry-press-room",
    "name": "Press conference",
    "description": "For postgame explanations, confident predictions, and questions that never get answered.",
    "captions": [
      { "top": "THE PRESS CONFERENCE WON AGAIN", "bottom": "Still waiting for the football team to try it." },
      { "top": "ANOTHER HALF HOUR OF ANSWERS", "bottom": "None for third and long." },
      { "top": "THE ROOM ASKED ABOUT THE DEFENSE", "bottom": "The room learned about the stadium." },
      { "top": "THE ONLY THING GETTING PROTECTED", "bottom": "Is the explanation." },
      { "top": "ELITE AT EXTENDING THE SEASON", "bottom": "One press conference at a time." },
      { "top": "THERE'S A PLAN FOR EVERYTHING", "bottom": "Especially explaining why there wasn't a plan." },
      { "top": "POSTGAME ADJUSTMENTS", "bottom": "Change the subject. Keep the general manager." },
      { "top": "THE TEAM FINALLY FOUND A CONSISTENT OFFENSE", "bottom": "Taking offense at the questions." }
    ]
  },
  {
    "id": "jerry-all-in",
    "name": "All in",
    "description": "For offseason hype, promised upgrades, and championship ambitions on a budget.",
    "captions": [
      { "top": "ALL IN", "bottom": "On the announcement." },
      { "top": "SUPER BOWL AMBITIONS", "bottom": "Clearance-rack execution." },
      { "top": "THE CHECKBOOK IS OPEN", "bottom": "To the page where we stopped last year." },
      { "top": "THE SPLASH MOVE", "bottom": "Was the stadium fountain." },
      { "top": "ANOTHER AGGRESSIVE OFFSEASON", "bottom": "The adjectives were unstoppable." },
      { "top": "THE ROSTER HAS BEEN UPGRADED", "bottom": "To the same roster with a new slogan." },
      { "top": "WIN-NOW MODE", "bottom": "Please allow 3–5 business seasons." },
      { "top": "THE MISSING PIECE", "bottom": "Apparently sold separately." }
    ]
  },
  {
    "id": "jerry-owner-gm",
    "name": "Owner and GM",
    "description": "For hiring decisions, endless votes of confidence, and a very short chain of command.",
    "captions": [
      { "top": "OWNER REVIEWS THE GENERAL MANAGER", "bottom": "Unanimous vote of confidence." },
      { "top": "THE ORGANIZATIONAL CHART", "bottom": "Is a self-portrait." },
      { "top": "ANOTHER COACH GETS THE BLAME", "bottom": "The hiring manager gets a new coach." },
      { "top": "THE FOOTBALL DEPARTMENT GOT A SECOND OPINION", "bottom": "Jerry changed chairs." },
      { "top": "THE GENERAL MANAGER IS ON THE HOT SEAT", "bottom": "The owner ordered a cushion." },
      { "top": "THE TEAM NEEDS BETTER DIRECTION", "bottom": "The GPS is the guy who got them lost." },
      { "top": "ACCOUNTABILITY STARTS AT THE TOP", "bottom": "Then takes the private elevator out." },
      { "top": "EVERYONE IS REPLACEABLE", "bottom": "Except the reason everyone keeps getting replaced." }
    ]
  },
  {
    "id": "jerry-next-year",
    "name": "Another season",
    "description": "For familiar endings, recycled optimism, and championship plans that keep rolling over.",
    "captions": [
      { "top": "THE SUPER BOWL PLAN", "bottom": "Same document. Different year in the filename." },
      { "top": "THE CHAMPIONSHIP WINDOW", "bottom": "Apparently opens directly onto the parking lot." },
      { "top": "THE TROPHY ROOM EXPANSION", "bottom": "Has been converted to a gift shop." },
      { "top": "THE FUTURE IS BRIGHT", "bottom": "The present is under further review." },
      { "top": "A NEW ERA OF COWBOYS FOOTBALL", "bottom": "Featuring all your favorite old problems." },
      { "top": "THE SEASON HAD A HAPPY ENDING", "bottom": "For the group chat." },
      { "top": "THE REBUILD IS ALMOST COMPLETE", "bottom": "Just needs the rebuilding part." },
      { "top": "ANOTHER BANNER YEAR", "bottom": "The banner says NEXT YEAR." }
    ]
  }
]
;
export function mountCaptionPacks(root, onChoose){
 const wrap=document.createElement('details');wrap.className='caption-packs';const summary=document.createElement('summary');summary.textContent='Jerry caption packs';wrap.append(summary);const select=document.createElement('select');select.setAttribute('aria-label','Jerry caption pack');for(const pack of captionPacks){const option=document.createElement('option');option.value=pack.id;option.textContent=pack.name;select.append(option);}wrap.append(select);const list=document.createElement('div');list.className='caption-pack-list';wrap.append(list);function render(){list.replaceChildren();const pack=captionPacks.find(p=>p.id===select.value);for(const caption of pack.captions){const button=document.createElement('button');button.type='button';button.className='caption-choice';const top=document.createElement('strong'),bottom=document.createElement('span');top.textContent=caption.top;bottom.textContent=caption.bottom;button.append(top,bottom);button.onclick=()=>onChoose(caption);list.append(button);}}select.onchange=render;render();root.append(wrap);return wrap;
}
