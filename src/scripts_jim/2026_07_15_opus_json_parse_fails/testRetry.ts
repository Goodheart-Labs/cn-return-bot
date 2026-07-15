import { parseJsonWithRetry } from "../../pipeline/utils/jsonLlmCall";
import { ModelOutputInvalidError } from "../../pipeline/utils/errors";

type Out = { findings: string; correction_needed: boolean };
const HINT = `{ "findings": string, "correction_needed": boolean }`;
const parse = (t: string) => { const o = JSON.parse(t) as Out;
  if (typeof o.findings!=="string"||typeof o.correction_needed!=="boolean") throw new Error("shape"); return o; };

// 1) succeeds first try — no corrective messages appended
{
  const msgs:any[] = [{role:"user",content:"go"}];
  let calls=0;
  const r = await parseJsonWithRetry<Out>({ source:"t1", messages:msgs, schemaHint:HINT,
    call: async()=>{ calls++; return { toParse:`{"findings":"ok","correction_needed":false}`, assistantEcho:"raw ok" }; }, parse });
  console.log(`T1 success-first: calls=${calls} (exp 1), msgs=${msgs.length} (exp 1), findings=${r.findings}`);
}

// 2) prose twice, then valid JSON on attempt 3 — recovers, appends 2 corrective pairs
{
  const msgs:any[] = [{role:"user",content:"go"}];
  let calls=0;
  const replies = ["This is clear: no JSON here", `{"reasoning":"{ nested`, `{"findings":"recovered","correction_needed":true}`];
  const r = await parseJsonWithRetry<Out>({ source:"t2", messages:msgs, schemaHint:HINT,
    call: async(m,attempt)=>{ calls++; const raw=replies[attempt-1]; return { toParse:raw, assistantEcho:raw }; }, parse });
  console.log(`T2 recover-on-3: calls=${calls} (exp 3), msgs=${msgs.length} (exp 5: user+2×[assistant,user]), findings=${r.findings}`);
  console.log(`   last corrective user msg: "${(msgs[msgs.length-1].content as string).slice(0,50)}..."`);
}

// 3) never valid — throws ModelOutputInvalidError after 3 attempts, outcomeReason set
{
  const msgs:any[] = [{role:"user",content:"go"}];
  let calls=0, threw=false, reason="";
  try {
    await parseJsonWithRetry<Out>({ source:"searchWithAnthropicNative", messages:msgs, schemaHint:HINT,
      call: async()=>{ calls++; return { toParse:"prose only", assistantEcho:"prose only" }; }, parse });
  } catch(e:any){ threw = e instanceof ModelOutputInvalidError; reason = e.outcomeReason; 
    console.log(`T3 give-up: calls=${calls} (exp 3), threw ModelOutputInvalidError=${threw}, outcomeReason=${reason}`);
    console.log(`   msg: ${e.message.slice(0,90)}`); }
}

// 4) shape-invalid ({} parses but wrong shape) triggers retry
{
  const msgs:any[] = [{role:"user",content:"go"}];
  let calls=0;
  const replies = ["{}", `{"findings":"good","correction_needed":false}`];
  const r = await parseJsonWithRetry<Out>({ source:"t4", messages:msgs, schemaHint:HINT,
    call: async(m,attempt)=>{ calls++; const raw=replies[attempt-1]; return { toParse:raw, assistantEcho:raw }; }, parse });
  console.log(`T4 empty-obj-retries: calls=${calls} (exp 2), findings=${r.findings}`);
}
process.exit(0);
