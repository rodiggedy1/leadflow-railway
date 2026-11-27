import {calculateTeamScore,TEAM_SCORE_METRICS,type TeamLeaderboardRow} from './teamLeaderboard';

type ReviewDetails=Record<string,{complaintCases:number;refundRequests:number;confirmedRecoveryCases?:number}>;
/** Teams with fewer completed jobs stay visible with their score but are not given a rank (owner decision). */
export const MIN_RANKED_JOBS=3;
export function rankAssessedScores(rows:TeamLeaderboardRow[],details:ReviewDetails={}){
 const result=rows.map(team=>{
  const review=details[team.id];
  const cases=review?.complaintCases;
  // The approved isolated test contains refund requests but no recorded completed recovery outcomes.
  // Requests never become recovery events. This default applies only to this review snapshot.
  const recoveryCases=review?.confirmedRecoveryCases??0;
  const validJobs=Number.isInteger(team.eligibleJobs)&&team.eligibleJobs>0;
  const validCases=validJobs&&Number.isInteger(cases)&&cases!>=0&&cases!<=team.eligibleJobs;
  const validRecovery=validJobs&&Boolean(review)&&Number.isInteger(recoveryCases)&&recoveryCases>=0&&recoveryCases<=team.eligibleJobs;
  const testEvidence={...team,metrics:{...team.metrics,
   complaints:{successful:validCases?team.eligibleJobs-cases!:0,eligible:team.eligibleJobs,complete:validCases},
   recovery:{successful:validRecovery?team.eligibleJobs-recoveryCases:0,eligible:team.eligibleJobs,complete:validRecovery}
  }};
  const score=calculateTeamScore(testEvidence);
  const availablePoints=TEAM_SCORE_METRICS.reduce((sum,metric)=>sum+(score.points[metric.key]===null?0:metric.weight),0);
  const completeNonRating=TEAM_SCORE_METRICS.filter(metric=>metric.key!=='ratings').every(metric=>score.points[metric.key]!==null);
  // Same metrics and weights; the total is scored out of 100 on the points that apply, so a team with no
  // received customer ratings (N/A) is not ranked below a team that has them.
  const earned=Object.values(score.points).reduce<number>((sum,points)=>sum+(points??0),0);
  const totalScore=validJobs&&completeNonRating&&availablePoints>0?Math.round(earned/availablePoints*10000)/100:null;
  const unrankedReason=totalScore!==null&&team.eligibleJobs<MIN_RANKED_JOBS?`Unranked: fewer than ${MIN_RANKED_JOBS} completed jobs`:null;
  return {...team,score,availablePoints,confirmedRecoveryCases:recoveryCases,totalScore,unrankedReason,rank:null as number|null};
 });
 // Ranked teams first, then teams shown with a score but unranked, then teams with no score.
 const group=(team:typeof result[number])=>team.totalScore===null?2:team.unrankedReason!==null?1:0;
 result.sort((a,b)=>group(a)-group(b)||(b.totalScore??-Infinity)-(a.totalScore??-Infinity)||a.name.localeCompare(b.name));
 let position=0;
 return result.map(team=>team.totalScore===null||team.unrankedReason!==null?team:{...team,rank:++position});
}
