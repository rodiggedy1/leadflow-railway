import {calculateTeamScore,TEAM_SCORE_METRICS,type TeamLeaderboardRow} from './teamLeaderboard';

type ReviewDetails=Record<string,{complaintCases:number;refundRequests:number;confirmedRecoveryCases?:number}>;
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
  const totalScore=validJobs&&completeNonRating?Object.values(score.points).reduce<number>((sum,points)=>sum+(points??0),0):null;
  return {...team,score,availablePoints,confirmedRecoveryCases:recoveryCases,totalScore,rank:null as number|null};
 }).sort((a,b)=>(b.totalScore??-Infinity)-(a.totalScore??-Infinity)||a.name.localeCompare(b.name));
 let position=0;
 return result.map(team=>team.totalScore===null?team:{...team,rank:++position});
}
