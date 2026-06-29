export const meta = {
  name: 'worldcup-2026-results',
  description: 'Fetch & adversarially verify 2026 FIFA World Cup group A–I scores and any knockout results from Wikipedia',
  phases: [
    { title: 'Fetch' },
    { title: 'Verify' },
    { title: 'Knockout' },
  ],
}

// Group fixtures in the EXACT home/away orientation used by the app's seed.
// Each team carries an English hint so the agent can search Wikipedia.
// Results MUST be returned in this same order & orientation so they join cleanly.
const FIXTURES = {
  A: { teams: '墨西哥=Mexico, 南非=South Africa, 韓國=South Korea, 捷克=Czechia',
    f: [['墨西哥','南非'],['韓國','捷克'],['捷克','南非'],['墨西哥','韓國'],['捷克','墨西哥'],['南非','韓國']] },
  B: { teams: '加拿大=Canada, 波赫=Bosnia and Herzegovina, 卡達=Qatar, 瑞士=Switzerland',
    f: [['加拿大','波赫'],['卡達','瑞士'],['瑞士','波赫'],['加拿大','卡達'],['瑞士','加拿大'],['波赫','卡達']] },
  C: { teams: '巴西=Brazil, 摩洛哥=Morocco, 海地=Haiti, 蘇格蘭=Scotland',
    f: [['巴西','摩洛哥'],['海地','蘇格蘭'],['蘇格蘭','摩洛哥'],['巴西','海地'],['蘇格蘭','巴西'],['摩洛哥','海地']] },
  D: { teams: '美國=United States, 巴拉圭=Paraguay, 澳洲=Australia, 土耳其=Turkey',
    f: [['美國','巴拉圭'],['澳洲','土耳其'],['美國','澳洲'],['土耳其','巴拉圭'],['土耳其','美國'],['巴拉圭','澳洲']] },
  E: { teams: '德國=Germany, 庫拉索=Curaçao, 科特迪瓦=Ivory Coast, 厄瓜多=Ecuador',
    f: [['德國','庫拉索'],['科特迪瓦','厄瓜多'],['德國','科特迪瓦'],['厄瓜多','庫拉索'],['庫拉索','科特迪瓦'],['厄瓜多','德國']] },
  F: { teams: '荷蘭=Netherlands, 日本=Japan, 瑞典=Sweden, 突尼斯=Tunisia',
    f: [['荷蘭','日本'],['瑞典','突尼斯'],['荷蘭','瑞典'],['突尼斯','日本'],['日本','瑞典'],['突尼斯','荷蘭']] },
  G: { teams: '比利時=Belgium, 埃及=Egypt, 伊朗=Iran, 紐西蘭=New Zealand',
    f: [['比利時','埃及'],['伊朗','紐西蘭'],['比利時','伊朗'],['紐西蘭','埃及'],['埃及','伊朗'],['紐西蘭','比利時']] },
  H: { teams: '西班牙=Spain, 佛得角=Cape Verde, 沙特阿拉伯=Saudi Arabia, 烏拉圭=Uruguay',
    f: [['西班牙','佛得角'],['沙特阿拉伯','烏拉圭'],['西班牙','沙特阿拉伯'],['烏拉圭','佛得角'],['佛得角','沙特阿拉伯'],['烏拉圭','西班牙']] },
  I: { teams: '法國=France, 塞內加爾=Senegal, 伊拉克=Iraq, 挪威=Norway',
    f: [['法國','塞內加爾'],['伊拉克','挪威'],['法國','伊拉克'],['挪威','塞內加爾'],['挪威','法國'],['塞內加爾','伊拉克']] },
}

const GROUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['group', 'results'],
  properties: {
    group: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['home', 'away', 'homeScore', 'awayScore'],
        properties: {
          home: { type: 'string' }, away: { type: 'string' },
          homeScore: { type: ['integer', 'null'] }, awayScore: { type: ['integer', 'null'] },
        },
      },
    },
    sourceNote: { type: 'string' },
  },
}

const groups = Object.keys(FIXTURES)

const fetchPrompt = (g) => {
  const fx = FIXTURES[g]
  const lines = fx.f.map((m, i) => `${i + 1}. ${m[0]} vs ${m[1]}`).join('\n')
  return `You are a sports-data extractor for the 2026 FIFA World Cup. Group ${g} team name map (Chinese=English): ${fx.teams}

Use WebFetch on https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_group_stage (and WebSearch if needed) to find the FINAL score of every Group ${g} match. The group stage is fully complete (ended 27 June 2026).

Return the results for these ${fx.f.length} fixtures, IN THIS EXACT ORDER and home/away orientation (do not swap):
${lines}

For each fixture return homeScore and awayScore as integers (the home team is the FIRST name). If a score genuinely cannot be found, use null (never guess). Echo back home/away exactly as the Chinese names given. Set group to "${g}".`
}

const verifyPrompt = (g, res) => `Adversarially verify these extracted Group ${g} 2026 World Cup scores. Re-check against https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_group_stage via WebFetch.

Extracted: ${JSON.stringify(res?.results ?? [])}

Recompute the group table (win=3, draw=1) and confirm it is internally consistent and matches Wikipedia's standings. Correct any wrong scoreline. Return the FULL corrected results array in the SAME order/orientation, group "${g}". If a score is unverifiable, set it null rather than guessing.`

// Pipeline: fetch each group's scores, then a second agent verifies/corrects.
const groupResults = await pipeline(
  groups,
  (g) => agent(fetchPrompt(g), { label: `fetch:${g}`, phase: 'Fetch', schema: GROUP_SCHEMA }),
  (res, g) => agent(verifyPrompt(g, res), { label: `verify:${g}`, phase: 'Verify', schema: GROUP_SCHEMA }),
)

// Knockout: fetch any played knockout results (likely few/none this early).
const KO_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['matchId', 'team1En', 'team2En', 'score1', 'score2', 'status'],
        properties: {
          matchId: { type: 'integer' },
          team1En: { type: 'string' }, team2En: { type: 'string' },
          score1: { type: ['integer', 'null'] }, score2: { type: ['integer', 'null'] },
          status: { type: 'string' },
        },
      },
    },
  },
}

const ko = await agent(
  `Use WebFetch on https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage to find every knockout match (FIFA match numbers 73–104) that has ALREADY been PLAYED and has a final or in-progress score. Today is 29 June 2026, so most are not played yet. For each PLAYED match return matchId, the two teams in English (team1En/team2En, team1 = first/home side), score1/score2 as integers, and status ("FT", "live", or "AET"/penalties note). Return an empty matches array if none have results yet. Never invent scores.`,
  { label: 'fetch:knockout', phase: 'Knockout', schema: KO_SCHEMA },
)

return {
  groups: groupResults.filter(Boolean),
  knockout: ko?.matches ?? [],
}
