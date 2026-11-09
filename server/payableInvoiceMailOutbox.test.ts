import { describe, it, expect, vi } from "vitest";
import type { Pool } from "mysql2/promise";
import { InvoiceMailOutbox } from "./payableInvoiceMailOutbox";
const uuid="11111111-1111-4111-8111-111111111111";
function fixture(){
 const entries=new Map<string,{payloadHash:unknown,state:string}>();
 const execute=vi.fn(async(sql:string,params:unknown[])=>{
  const key=String(sql.startsWith("INSERT")?params[0]:sql.startsWith("SELECT")?params[0]:sql.includes("state = 'sent'")?params[2]:params[0]);
  if(sql.startsWith("INSERT")){if(entries.has(key))throw Object.assign(new Error("duplicate"),{code:"ER_DUP_ENTRY"});entries.set(key,{payloadHash:params[3],state:"pending"});}
  if(sql.startsWith("SELECT"))return[[entries.get(key)],[]];
  if(sql.includes("state = 'sent'"))entries.get(key)!.state="sent";
  if(sql.includes("state = 'unknown'"))entries.get(key)!.state="unknown";
  return[{affectedRows:1},[]];
 });
 const outbox=new InvoiceMailOutbox(async()=>({execute}) as unknown as Pool);
 return{outbox,entries,execute};
}
describe("explicit invoice email outbox",()=>{
 it("sends once and returns persisted success for the same request",async()=>{const f=fixture();const send=vi.fn(async()=>({messageId:"mail_test"}));await f.outbox.send(uuid,1,"example@example.test","https://invoice.example.test/invoice/token",send);expect(await f.outbox.send(uuid,1,"example@example.test","https://invoice.example.test/invoice/token",send)).toEqual({sent:true,replayed:true});expect(send).toHaveBeenCalledOnce();});
 it("rejects a replay for another invoice or recipient",async()=>{const f=fixture();const send=vi.fn(async()=>({messageId:"mail_test"}));await f.outbox.send(uuid,1,"example@example.test","https://invoice.example.test/invoice/token",send);await expect(f.outbox.send(uuid,2,"other@example.test","https://invoice.example.test/invoice/token",send)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});expect(send).toHaveBeenCalledOnce();});
 it("keeps uncertain delivery pending review without resending",async()=>{const f=fixture();const send=vi.fn(async()=>{throw Error("unknown provider response");});await expect(f.outbox.send(uuid,1,"example@example.test","https://invoice.example.test/invoice/token",send)).rejects.toMatchObject({code:"SEND_REVIEW_REQUIRED"});await expect(f.outbox.send(uuid,1,"example@example.test","https://invoice.example.test/invoice/token",send)).rejects.toMatchObject({code:"SEND_REVIEW_REQUIRED"});expect(send).toHaveBeenCalledOnce();expect(f.entries.get(uuid)?.state).toBe("unknown");});
});
