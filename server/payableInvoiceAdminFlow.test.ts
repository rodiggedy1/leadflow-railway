import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { PayableInvoiceService } from "./payableInvoiceService";
import type { InvoiceMailOutbox } from "./payableInvoiceMailOutbox";
import { registerPayableInvoiceRoutes, INVOICE_API } from "./payableInvoiceRoutes";
const origin="https://invoice.example.test",uuid="11111111-1111-4111-8111-111111111111",reviewHash="a".repeat(64);
function fixture(admin=true){
 const invoice={id:1,number:"INV-EXAMPLE",clientId:1,clientName:"Example",from:"2026-07-22",to:"2026-11-07",dueDate:"2026-11-20",currency:"usd",status:"partially_paid",lines:[{id:1,date:"2026-07-22",description:"Service",address:"Example street",occurrenceKey:"job:1",amountCents:10000,paidCents:10000,manualPaidCents:10000}],receipts:[],activeAttemptId:null};
 const fake={markAlreadyPaid:vi.fn(async()=>({client:{id:1},services:[],reviewHash})),issue:vi.fn(async()=>({invoice,url:origin+"/invoice/"+reviewHash})),adminInvoice:vi.fn(async()=>({invoice,client:{id:1,name:"Example",phone:"+12025550100",email:"verified@example.test"},requestId:uuid,url:origin+"/invoice/"+reviewHash}))};
 const send=vi.fn(async()=>({messageId:"mail_example",threadId:"thread_example"}));
 const outbox={send:vi.fn(async(_requestId:string,_id:number,_recipient:string,_url:string,deliver:()=>Promise<{messageId:string}>)=>{await deliver();return{sent:true};})};
 const app=express();registerPayableInvoiceRoutes(app,{origin,admin:async()=>admin?17:false,service:fake as unknown as PayableInvoiceService,outbox:outbox as unknown as InvoiceMailOutbox,send});
 return{app,fake,send,outbox};
}
const mark={requestId:uuid,clientId:1,from:"2026-07-22",to:"2026-11-07",serviceIds:["job:1"],reviewHash};
describe("invoice staff actions",()=>{
 it("marks already paid with only the current selection and verified administrator",async()=>{const f=fixture();await request(f.app).post(INVOICE_API+"/admin/mark-paid").set("Origin",origin).send(mark).expect(200);expect(f.fake.markAlreadyPaid).toHaveBeenCalledWith(mark,17);expect(f.send).not.toHaveBeenCalled();});
 it("does not let an unauthenticated user mark paid",async()=>{const f=fixture(false);await request(f.app).post(INVOICE_API+"/admin/mark-paid").set("Origin",origin).send(mark).expect(403);expect(f.fake.markAlreadyPaid).not.toHaveBeenCalled();});
 it("rejects browser-supplied manual payment amounts and staff identities",async()=>{const f=fixture();await request(f.app).post(INVOICE_API+"/admin/mark-paid").set("Origin",origin).send({...mark,amountCents:1,agentId:999}).expect(400);expect(f.fake.markAlreadyPaid).not.toHaveBeenCalled();});
 it("issues the reviewed client period without automatic email",async()=>{const f=fixture();await request(f.app).post(INVOICE_API+"/admin/issue").set("Origin",origin).send({...mark,dueDate:"2026-11-20",confirmedUnpaid:true}).expect(200);expect(f.fake.issue).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();});
 it("requires explicit send confirmation and accepts no recipient override",async()=>{const f=fixture();await request(f.app).post(INVOICE_API+"/admin/1/send").set("Origin",origin).send({requestId:uuid,confirmed:true,to:"other@example.test"}).expect(400);expect(f.send).not.toHaveBeenCalled();});
 it("sends only to the stored verified billing email, through the durable outbox",async()=>{const f=fixture();await request(f.app).post(INVOICE_API+"/admin/1/send").set("Origin",origin).send({requestId:uuid,confirmed:true}).expect(200);expect(f.send).toHaveBeenCalledWith(expect.objectContaining({id:1}),origin+"/invoice/"+reviewHash,"verified@example.test");expect(f.outbox.send).toHaveBeenCalledOnce();});
 it("downloads the issued invoice PDF without calling a sender",async()=>{const f=fixture();const response=await request(f.app).get(INVOICE_API+"/admin/1/pdf").expect(200);expect(response.headers["content-type"]).toMatch(/application\/pdf/);expect(f.send).not.toHaveBeenCalled();});
});
