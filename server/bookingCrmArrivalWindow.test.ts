import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {renderToStaticMarkup} from "react-dom/server";
import * as ts from "typescript";
import {describe,expect,it,vi} from "vitest";
import * as reschedule from "../shared/bookingReschedule";
import * as dialog from "../client/src/components/ui/dialog";
import {createBookingArrivalPreference as pref} from "../shared/bookingArrival";
import {getPublicBookingArrivalPreference as arrival,isPublicBookingPriceSnapshot,PUBLIC_BOOKING_PRICING_VERSION as VERSION} from "../shared/publicBookingPricing";
import {getBookingArrivalWindowLabel as label} from "../client/src/lib/bookingArrivalDisplay";

const scope={getPublicBookingArrivalPreference: arrival,isPublicBookingPriceSnapshot,getBookingArrivalWindowLabel: label};
const root=resolve(import.meta.dirname,"..");
const BASE="3add52e9114e76d08ca686f434f8eedb71d3b984";
const native="client/src/components/NativeBookingsWorkspace.tsx",crm="client/src/pages/BookingsCRMExactLive.tsx",admin="server/bookingsRouter.ts";
const read=(p: string)=>readFileSync(resolve(root,p),"utf8");
const base=(p: string)=>execFileSync("git",["-c",`safe.directory=${root}`,"show",`${BASE}:${p}`],{cwd: root,encoding: "utf8",env: {PATH: process.env.PATH}});
const parse=(s: string)=>ts.createSourceFile("source.tsx",s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const printer=ts.createPrinter({removeComments: true});
const print=(n: ts.Node,f: ts.SourceFile)=>printer.printNode(ts.EmitHint.Unspecified,n,f);
const name=(n: {name?: ts.Node})=>n.name && ts.isIdentifier(n.name) ? n.name.text : "";
const hf=parse(read("server/bookingRescheduleClient.test.ts"));
const end=hf.statements.findIndex(n=>ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(hf) === "describe");
if (end < 0) throw new Error("Missing harness boundary");
const code=hf.statements.slice(0,end).filter(n=>!ts.isImportDeclaration(n)).map(n=>print(n,hf)).join("\n").replace("import.meta.dirname","DIR");
const module={exports: {} as any};
runInNewContext(ts.transpileModule(`${code}\nmodule.exports={workspace,elements,text,execute};`,{compilerOptions: {module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,jsx: ts.JsxEmit.ReactJSX}}).outputText,
{module,exports: module.exports,DIR: resolve(root,"server"),execFileSync,readFileSync,resolve,runInNewContext,React,jsxRuntime,renderToStaticMarkup,ts,expect,vi,reschedule,dialog,...scope});
const {workspace,elements,text,execute}=module.exports;
function load(p: string,fn: string,s=read(p)) {
const f=parse(s),n=f.statements.find(n=>ts.isFunctionDeclaration(n) && name(n) === fn);
if (!n) throw new Error(`Missing ${fn}`);
const helpers=fn === "mapAdminBooking" ? "" : f.statements.filter(ts.isVariableStatement).filter(n=>!n.declarationList.declarations.some(d=>name(d) === "NAV")).map(n=>print(n,f)).join("\n");
const stubs="CalendarDays MessageCircle CreditCard MapPin MoreHorizontal X ImageIcon Loader2 Copy NativeBookingCommercialEditor BookingPayrollPanel BookingPaymentActions PortalRequestPaymentActions".split(" ");
return execute(`${helpers}\n${print(n,f)}\nmodule.exports={${fn}};`,{},{...Object.fromEntries(stubs.map(n=>[n,()=>null])),useState: ()=>[null,vi.fn()],...scope})[fn];
}
const rows=[native,crm].map(p=>load(p,"BookingListRow")),oldRows=[native,crm].map(p=>load(p,"BookingListRow",base(p)));
const drawer=load(crm,"BookingDetailDrawer"),oldDrawer=load(crm,"BookingDetailDrawer",base(crm));
const cases: Array<[any,string]>=[
[pref("preferred","afternoon"),"12:00 PM–5:00 PM"],[pref("flexible"),"8:30 AM–5:00 PM"],[pref("preferred","morning"),"8:00 AM–12:00 PM"],
...["08:30","10:30","12:30","14:30","16:30"].map((s,i)=>[pref("exact",undefined,s),["8:30 AM–10:30 AM","10:30 AM–12:30 PM","12:30 PM–2:30 PM","2:30 PM–4:30 PM","4:30 PM–6:30 PM"][i]] as [any,string]),
];
const pm=cases[0][0];
const snap=(arrivalPreference: unknown)=>({version: VERSION,serviceName: "Standard",input: {homeType: "House",arrivalPreference},breakdown: {}});
const sum=(tree: any,cls: string)=>text(elements(tree).find((n: any)=>n.props.className === cls));
function seed(h: any,time: any,arrivalPreference: unknown) {
const update=(r: any)=>({...r,requestedLocalTime: time,arrivalPreference});
h.queries["bookings.list"]=h.queries["bookings.list"].map(update);h.queries["bookings.get"]=update(h.queries["bookings.get"]);h.render();
}
describe("CRM arrivals (offline)",()=>{
it("admin mapper parity and immutability",()=>{
 const prev=load(admin,"mapAdminBooking",base(admin)),next=load(admin,"mapAdminBooking");
 for (const priceSnapshot of [...cases.map(([v])=>snap(v)),null,undefined,"broken",{},{version: "legacy",input: {arrivalPreference: pm}},snap({...pm,endLocalTime: "18:00"}),{...snap(undefined),arrivalPreference: pm}]) for (const a of [undefined,{teamId: 7,teamName: "Synthetic"},{teamId: null,teamName: null}]) {
  const r: any={id: 41,priceSnapshot,requestedLocalTime: "12:00",extras: [{id: "oven",quantity: 2}],specialRequestNotes: ["Synthetic"]};
  for (const key of Object.keys(prev(r))) if (!(key in r)) r[key]=`${key}:sentinel`;
  const orig=structuredClone(r),{arrivalPreference,...rest}=next(r,a);
  expect(rest).toEqual(prev(r,a));expect(arrivalPreference).toEqual(arrival(priceSnapshot) ?? null);
  expect(r).toEqual(orig);expect(rest.requestedLocalTime).toBe("12:00");
}
});
it.each(cases)("rows/drawers window %#;editor start unchanged",(p,label)=>{
 const h=workspace();seed(h,p.startLocalTime,p);
 expect(h.model.rows[0].arrivalPreference).toEqual(p);expect(h.model.active.arrivalPreference).toEqual(p);
 for (const Row of rows) expect(text(elements(Row({row: h.model.rows[0]})).find((n: any)=>n.type === "b"))).toBe(label);
 expect(sum(h.renderNative(),"bookings-detail-summary")).toContain(`${label} · Nov 10, 2026`);
 const tree=drawer({model: h.model});expect(sum(tree,"bcr-detail-summary")).toContain(`${label} · Nov 10, 2026`);
 expect(elements(tree).find((n: any)=>n.props["aria-label"] === "Booking time").props.value).toBe(p.startLocalTime);
 expect(Object.values(h.mutations).every((v: any)=>!v.mutate.mock.calls.length)).toBe(true);
});
it("absent/invalid/stale: base fallbacks",()=>{
 for (const [time,p] of [["12:00",undefined],["12:00",null],["12:00",{}],["12:00",{...pm,extra: true}],["12:00",{...pm,endLocalTime: "18:00"}],["14:35",pm],["12:00:00",pm],["12:00 PM",pm],[null,pm],[undefined,pm]] as any[]) {
  expect(label(time,p)).toBeUndefined();
  const h=workspace(),old=workspace("booking","one-time","launch27_import",base(native));seed(h,time,p);seed(old,time,p);
  for (const i of [0,1]) expect(text(rows[i]({row: h.model.rows[0]}))).toBe(text(oldRows[i]({row: old.model.rows[0]})));
  expect(sum(h.renderNative(),"bookings-detail-summary")).toBe(sum(old.renderNative(),"bookings-detail-summary"));
  expect(sum(drawer({model: h.model}),"bcr-detail-summary")).toBe(sum(oldDrawer({model: old.model}),"bcr-detail-summary"));
}
});
it("funnel/quotes: explicit or exact canonical ID/time only",()=>{
 for (const src of ["staff","customer-booking-link"]) for (const s of ["explicit","legacy","linked","stale","missing","wrong","no-pref"]) {
  const h=workspace("funnel"),isLinked=!["explicit","legacy"].includes(s);
  const lead={...h.queries["bookingFunnel.get"],source: src,bookingId: isLinked ? 71 : null,requestedLocalTime: "12:00",priceSnapshot: s === "legacy" ? {} : snap(pm)};
  h.queries["bookingFunnel.get"]=lead;h.queries["bookingFunnel.list"]=[lead];
  h.queries["bookings.list"]=s === "missing" ? [] : [{...h.model.active,id: s === "wrong" ? 72 : 71,requestedLocalTime: s === "stale" ? "14:35" : "12:00",arrivalPreference: s === "no-pref" ? null : pm}];
  if (src === "customer-booking-link") h.model.setView("quotes");h.render();
  const want=["explicit","linked"].includes(s) ? pm : s === "no-pref" ? null : undefined;
  expect(h.model.active.arrivalPreference).toEqual(want);
  if (!isLinked || src === "customer-booking-link") expect(h.model.rows.find((r: any)=>r.key === "funnel:41").arrivalPreference).toEqual(want);
}
});
it("reschedule payload and stale window",()=>{
 const h=workspace();seed(h,"12:00",pm);h.draft("2026-11-17","14:35");h.model.updateActiveRecordSchedule();h.render();
 expect(h.mutations["bookings.updateDetails"].mutate.mock.calls[0][0]).toEqual({bookingId: 41,requestedLocalDate: "2026-11-17",requestedLocalTime: "14:35",rescheduleMode: "visit"});
 seed(h,"14:35",pm);expect(sum(drawer({model: h.model}),"bcr-detail-summary")).toContain("2:35 PM · Nov 10, 2026");
});
});
it("AST: handlers/hooks/logic unchanged except display mapping",()=>{
function norm(s: string) {
 const result=ts.transform(parse(s),[ctx=>{
  const visit: ts.Visitor=n=>{
   if (ts.isImportDeclaration(n)) return undefined;
   if ((ts.isPropertyAssignment(n) || ts.isPropertySignature(n)) && name(n) === "arrivalPreference") return undefined;
   if (ts.isVariableStatement(n) && n.declarationList.declarations.some(n=>name(n) === "funnelArrivalPreference")) return undefined;
   if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && ts.isCallExpression(n.left) && ts.isIdentifier(n.left.expression) && n.left.expression.text === "getBookingArrivalWindowLabel") return n.right;
   if (ts.isArrayLiteralExpression(n) && ts.isCallExpression(n.parent) && ts.isVariableDeclaration(n.parent.parent) && name(n.parent.parent) === "active") return ctx.factory.updateArrayLiteralExpression(n,n.elements.filter(e=>!ts.isIdentifier(e) || e.text !== "bookings"));
   return ts.visitEachChild(n,visit,ctx);
 };
  return n=>ts.visitNode(n,visit) as ts.SourceFile;
}]);
 const out=printer.printFile(result.transformed[0]);result.dispose();return out;
}
for (const p of [native,crm,admin]) expect(norm(read(p)),p).toBe(norm(base(p)));
});
