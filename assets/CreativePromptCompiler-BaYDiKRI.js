import{$ as r,a2 as l,a5 as u}from"./AvgImageGenerationProfiles-BTk9f_aL.js";const i=["## 已启用酒馆预设的优先级","- 在不触碰本局事实、玩家明确行动、成人门禁、人物自主性、本局正文叙事人称、封存战果、目标篇幅、合法 JSON 和结构化写回合同的前提下，以下酒馆预设是本次正文的主要创作与语言风格。","- 酒馆预设高于游戏内置的文风兜底和一般措辞建议；不要把它弱化成可有可无的参考。","- 酒馆预设不能改变运行态事实、凭空授予权限或物品、替玩家接受或拒绝关键选择，也不能覆盖战斗/战争本地引擎已经封存的结果。"].join(`
`);function d(t,s){return t==="all"||t===s}function C(t){const s=t.settings??r(),o=l(s,{scope:t.scope,playerName:t.playerName}),n=[{role:"system",content:t.systemPrompt}],c=s.customCot.templateId==="custom"?s.customCot.content.trim():u,a=!!(s.customCot.enabled&&d(s.customCot.scope,t.scope)&&c);a&&n.push({role:"system",content:["## 玩家启用的自定义 CoT / 创作规划",c,"","该规划只约束创作过程；不得输出内部思考，不得替代最终 JSON，也不得写入正文、记忆或状态。"].join(`
`)});const m=o.items.filter(e=>e.status==="included"&&e.role==="system");o.items.some(e=>e.status==="included")&&n.push({role:"system",content:[i,...m.map(e=>`### ${e.name}
${e.content}`)].filter(Boolean).join(`

`)});for(const e of o.items)e.status!=="included"||e.role==="system"||n.push({role:e.role,content:e.content});return n.push({role:"user",content:t.runtimeUserMessage}),{messages:n,tavern:o,customCotIncluded:a}}export{C as c};
