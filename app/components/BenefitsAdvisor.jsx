"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── PLAN DATA ───────────────────────────────────────────────
const PREMIUMS_BIWEEKLY = {
  copay: { employee: 71.99, empChildren: 212.83, empSpouse: 529.62, family: 719.20 },
  cdhp:  { employee: 0,     empChildren: 119.68, empSpouse: 397.54, family: 476.32 },
};

const HSA_EMPLOYER = { employee: 1150, withDependents: 2300 };

const PLANS = {
  copay: {
    name: "Co-Pay Plan (PPO)",
    shortName: "Co-Pay",
    deductible: { individual: 1250, family: 3125 },
    oopMax: { individual: 6750, family: 13500 },
    primaryCare: { type: "copay", amount: 20, deductibleApplies: false },
    specialist: { type: "copay", amount: 40, deductibleApplies: false },
    preventive: { type: "free" },
    labXray: { type: "copay", amount: 20, deductibleApplies: false },
    imaging: { type: "coinsurance", rate: 0.15 },
    erVisit: { type: "copay", amount: 200, deductibleApplies: false },
    urgentCare: { type: "copay", amount: 75, deductibleApplies: false },
    hospitalFacility: { type: "coinsurance", rate: 0.15 },
    surgeonFees: { type: "coinsurance", rate: 0.15 },
    outpatientSurgeryFacility: { type: "coinsurance", rate: 0.15 },
    mentalHealthOutpatient: { type: "copay", amount: 20, deductibleApplies: false },
    mentalHealthInpatient: { type: "coinsurance", rate: 0.15 },
    maternityDelivery: { type: "coinsurance", rate: 0.15 },
    rx: {
      deductibleApplies: false,
      generic: { shortTerm: 10, maintenance: 15, mailOrder: 25 },
      preferredBrand: { shortTerm: 30, maintenance: 40, mailOrder: 75 },
      nonPreferredBrand: { shortTerm: 60, maintenance: 80, mailOrder: 150 },
      specialty: { genericPref: 0.10, nonPref: 0.15 },
    },
    physicalTherapy: { type: "copay", amount: 40, deductibleApplies: false },
  },
  cdhp: {
    name: "CDHP (with HSA)",
    shortName: "CDHP",
    deductible: { individual: 3300, family: 7500 },
    oopMax: { individual: 4100, family: 10250 },
    primaryCare: { type: "free_after_deductible" },
    specialist: { type: "coinsurance", rate: 0.05 },
    preventive: { type: "free" },
    labXray: { type: "free_after_deductible" },
    imaging: { type: "coinsurance", rate: 0.05 },
    erVisit: { type: "coinsurance", rate: 0.05 },
    urgentCare: { type: "coinsurance", rate: 0.05 },
    hospitalFacility: { type: "coinsurance", rate: 0.05 },
    surgeonFees: { type: "coinsurance", rate: 0.05 },
    outpatientSurgeryFacility: { type: "coinsurance", rate: 0.05 },
    mentalHealthOutpatient: { type: "free_after_deductible" },
    mentalHealthInpatient: { type: "coinsurance", rate: 0.05 },
    maternityDelivery: { type: "coinsurance", rate: 0.05 },
    rx: {
      deductibleApplies: true,
      generic: { shortTerm: 5, maintenance: 10, mailOrder: 10 },
      preferredBrand: { shortTerm: 20, maintenance: 30, mailOrder: 50 },
      nonPreferredBrand: { shortTerm: 40, maintenance: 60, mailOrder: 100 },
      specialty: { genericPref: 0.05, nonPref: 0.10 },
    },
    physicalTherapy: { type: "coinsurance", rate: 0.05 },
  },
};

// Average allowed amounts for cost modeling
const AVG_COSTS = {
  primaryCare: 275,
  specialist: 400,
  erVisit: 2800,
  urgentCare: 350,
  labXray: 150,
  imaging: 1200,
  hospitalDayFacility: 3500,
  surgeonFees: 4000,
  outpatientSurgery: 8000,
  mentalHealthVisit: 200,
  maternityTotal: 12000,
  physicalTherapyVisit: 200,
  genericRxMonth: 30,
  preferredBrandRxMonth: 250,
  nonPreferredBrandRxMonth: 500,
  specialtyRxMonth: 3000,
};

// ─── COST ESTIMATION ENGINE ──────────────────────────────────
function estimateAnnualCost(profile, planKey) {
  const plan = PLANS[planKey];
  const tier = profile.coverageTier;
  const isFamily = tier !== "employee";
  const premiumKey = tier === "employee" ? "employee" : tier === "empChildren" ? "empChildren" : tier === "empSpouse" ? "empSpouse" : "family";

  const annualPremium = PREMIUMS_BIWEEKLY[planKey][premiumKey] * 26;
  const deductible = isFamily ? plan.deductible.family : plan.deductible.individual;
  const oopMax = isFamily ? plan.oopMax.family : plan.oopMax.individual;

  let totalAllowedCharges = 0;
  let totalMemberCost = 0;
  let deductibleSpent = 0;

  const addCharge = (allowedAmount, serviceConfig, count = 1) => {
    for (let i = 0; i < count; i++) {
      totalAllowedCharges += allowedAmount;
      if (totalMemberCost >= oopMax) continue;

      if (serviceConfig.type === "free") {
        // No cost
      } else if (serviceConfig.type === "copay" && !serviceConfig.deductibleApplies) {
        totalMemberCost += serviceConfig.amount;
      } else if (serviceConfig.type === "free_after_deductible") {
        if (deductibleSpent < deductible) {
          const remaining = deductible - deductibleSpent;
          const applied = Math.min(remaining, allowedAmount);
          deductibleSpent += applied;
          totalMemberCost += applied;
        }
      } else if (serviceConfig.type === "coinsurance") {
        if (deductibleSpent < deductible) {
          const remaining = deductible - deductibleSpent;
          const applied = Math.min(remaining, allowedAmount);
          deductibleSpent += applied;
          totalMemberCost += applied;
          const afterDeductible = allowedAmount - applied;
          if (afterDeductible > 0) {
            totalMemberCost += afterDeductible * serviceConfig.rate;
          }
        } else {
          totalMemberCost += allowedAmount * serviceConfig.rate;
        }
      }
      totalMemberCost = Math.min(totalMemberCost, oopMax);
    }
  };

  // Primary care visits
  addCharge(AVG_COSTS.primaryCare, plan.primaryCare, profile.primaryCareVisits || 0);
  // Specialist visits
  addCharge(AVG_COSTS.specialist, plan.specialist, profile.specialistVisits || 0);
  // ER visits
  addCharge(AVG_COSTS.erVisit, plan.erVisit, profile.erVisits || 0);
  // Urgent care
  addCharge(AVG_COSTS.urgentCare, plan.urgentCare, profile.urgentCareVisits || 0);
  // Labs
  addCharge(AVG_COSTS.labXray, plan.labXray, profile.labVisits || 0);
  // Imaging
  addCharge(AVG_COSTS.imaging, plan.imaging, profile.imagingScans || 0);
  // Mental health
  addCharge(AVG_COSTS.mentalHealthVisit, plan.mentalHealthOutpatient, profile.mentalHealthVisits || 0);
  // Physical therapy
  addCharge(AVG_COSTS.physicalTherapyVisit, plan.physicalTherapy, profile.physicalTherapyVisits || 0);

  // Maternity
  if (profile.expectingBaby) {
    addCharge(AVG_COSTS.maternityTotal * 0.6, plan.maternityDelivery, 1);
    addCharge(AVG_COSTS.maternityTotal * 0.4, plan.hospitalFacility, 1);
  }

  // Surgery
  if (profile.expectingSurgery) {
    addCharge(AVG_COSTS.outpatientSurgery, plan.outpatientSurgeryFacility, 1);
    addCharge(AVG_COSTS.surgeonFees, plan.surgeonFees, 1);
  }

  // Hospital stays
  if (profile.hospitalDays > 0) {
    addCharge(AVG_COSTS.hospitalDayFacility * profile.hospitalDays, plan.hospitalFacility, 1);
    addCharge(AVG_COSTS.surgeonFees, plan.surgeonFees, 1);
  }

  // Prescriptions
  const rxDeductibleApplies = plan.rx.deductibleApplies;
  const addRx = (monthlyAllowed, copayAmount, months) => {
    for (let i = 0; i < months; i++) {
      totalAllowedCharges += monthlyAllowed;
      if (totalMemberCost >= oopMax) continue;
      if (rxDeductibleApplies && deductibleSpent < deductible) {
        const remaining = deductible - deductibleSpent;
        const applied = Math.min(remaining, monthlyAllowed);
        deductibleSpent += applied;
        totalMemberCost += applied;
        if (monthlyAllowed - applied > 0) {
          totalMemberCost += copayAmount;
        }
      } else {
        totalMemberCost += copayAmount;
      }
      totalMemberCost = Math.min(totalMemberCost, oopMax);
    }
  };

  addRx(AVG_COSTS.genericRxMonth, plan.rx.generic.maintenance, (profile.genericMeds || 0) * 12);
  addRx(AVG_COSTS.preferredBrandRxMonth, plan.rx.preferredBrand.maintenance, (profile.brandMeds || 0) * 12);
  addRx(AVG_COSTS.nonPreferredBrandRxMonth, plan.rx.nonPreferredBrand.maintenance, (profile.nonPreferredMeds || 0) * 12);
  addRx(AVG_COSTS.specialtyRxMonth, plan.rx.specialty.genericPref * AVG_COSTS.specialtyRxMonth, (profile.specialtyMeds || 0) * 12);

  // HSA employer contribution (only CDHP)
  let hsaContribution = 0;
  if (planKey === "cdhp") {
    hsaContribution = isFamily ? HSA_EMPLOYER.withDependents : HSA_EMPLOYER.employee;
  }

  return {
    annualPremium: Math.round(annualPremium),
    estimatedMedicalCosts: Math.round(totalMemberCost),
    hsaContribution,
    totalOutOfPocket: Math.round(annualPremium + totalMemberCost - hsaContribution),
    deductible,
    oopMax,
    deductibleSpent: Math.round(deductibleSpent),
  };
}

// ─── STYLES ──────────────────────────────────────────────────
const COLORS = {
  green900: "#1B3C28",
  green700: "#2A5A3B",
  green600: "#357A4D",
  green500: "#4A9960",
  green100: "#E8F0E6",
  green50: "#F4F8F3",
  sage: "#B5C9A1",
  sageMuted: "#C8D8B8",
  cream: "#FAFAF5",
  warmWhite: "#FEFDFB",
  gold: "#C5933A",
  goldLight: "#F5ECD7",
  text900: "#1A1A1A",
  text700: "#3D3D3D",
  text500: "#6B6B6B",
  text300: "#A0A0A0",
  border: "#E2E2DA",
  red: "#C0392B",
  redLight: "#FDECEC",
  blue: "#2471A3",
  blueLight: "#EBF5FB",
};

// ─── COMPONENTS ──────────────────────────────────────────────

function GreenhillLogo({ size = 32 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: size, height: size, borderRadius: 4,
        background: COLORS.sage,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Libre Baskerville', Georgia, serif",
        fontSize: size * 0.6, fontWeight: 700, color: "#fff",
        letterSpacing: -1,
      }}>G</div>
      <div>
        <div style={{
          fontFamily: "'Libre Baskerville', Georgia, serif",
          fontSize: size * 0.5, fontWeight: 700, color: COLORS.green900,
          lineHeight: 1.1, letterSpacing: 0.5,
        }}>Greenhill</div>
        <div style={{
          fontFamily: "'DM Sans', Helvetica, sans-serif",
          fontSize: size * 0.28, color: COLORS.text500,
          letterSpacing: 3, textTransform: "uppercase", lineHeight: 1.2,
        }}>SCHOOL</div>
      </div>
    </div>
  );
}

function ProgressBar({ step, totalSteps }) {
  const pct = ((step) / totalSteps) * 100;
  return (
    <div style={{ width: "100%", height: 4, background: COLORS.green100, borderRadius: 2, overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${COLORS.green600}, ${COLORS.green500})`,
        borderRadius: 2, transition: "width 0.5s ease",
      }} />
    </div>
  );
}

function OptionCard({ selected, onClick, title, subtitle, icon, recommended }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "flex-start",
      padding: "16px 20px", borderRadius: 12, cursor: "pointer",
      background: selected ? COLORS.green50 : "#fff",
      border: `2px solid ${selected ? COLORS.green600 : COLORS.border}`,
      transition: "all 0.2s ease", width: "100%", textAlign: "left",
      position: "relative", outline: "none",
    }}>
      {recommended && (
        <span style={{
          position: "absolute", top: -10, right: 12,
          background: COLORS.gold, color: "#fff",
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
          fontFamily: "'DM Sans', sans-serif", letterSpacing: 0.5,
        }}>POPULAR</span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
            fontSize: 15, color: COLORS.text900,
          }}>{title}</div>
          {subtitle && <div style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 13,
            color: COLORS.text500, marginTop: 2,
          }}>{subtitle}</div>}
        </div>
        <div style={{
          width: 22, height: 22, borderRadius: 11,
          border: `2px solid ${selected ? COLORS.green600 : COLORS.text300}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.2s",
        }}>
          {selected && <div style={{ width: 12, height: 12, borderRadius: 6, background: COLORS.green600 }} />}
        </div>
      </div>
    </button>
  );
}

function CounterInput({ value, onChange, min = 0, max = 50, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
      <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: COLORS.text700 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => onChange(Math.max(min, value - 1))} style={{
          width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`,
          background: "#fff", cursor: "pointer", fontSize: 18, color: COLORS.text500,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>−</button>
        <span style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600,
          color: COLORS.text900, width: 32, textAlign: "center",
        }}>{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))} style={{
          width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`,
          background: "#fff", cursor: "pointer", fontSize: 18, color: COLORS.text500,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>+</button>
      </div>
    </div>
  );
}

function StepContainer({ title, subtitle, children, onNext, onBack, nextLabel = "Continue", nextDisabled = false, step }) {
  return (
    <div style={{
      animation: "fadeIn 0.4s ease", maxWidth: 560, margin: "0 auto", padding: "0 20px",
    }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{
          fontFamily: "'Libre Baskerville', Georgia, serif",
          fontSize: 22, fontWeight: 700, color: COLORS.green900,
          margin: 0, lineHeight: 1.3,
        }}>{title}</h2>
        {subtitle && <p style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 14,
          color: COLORS.text500, margin: "8px 0 0", lineHeight: 1.5,
        }}>{subtitle}</p>}
      </div>
      <div style={{ marginBottom: 28 }}>{children}</div>
      <div style={{ display: "flex", gap: 12, justifyContent: "space-between" }}>
        {onBack ? (
          <button onClick={onBack} style={{
            padding: "12px 24px", borderRadius: 10, border: `1px solid ${COLORS.border}`,
            background: "#fff", cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: COLORS.text500,
          }}>Back</button>
        ) : <div />}
        <button onClick={onNext} disabled={nextDisabled} style={{
          padding: "12px 32px", borderRadius: 10, border: "none",
          background: nextDisabled ? COLORS.text300 : COLORS.green700,
          cursor: nextDisabled ? "default" : "pointer",
          fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: "#fff",
          transition: "background 0.2s",
        }}>{nextLabel}</button>
      </div>
    </div>
  );
}

function ToggleChip({ selected, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 16px", borderRadius: 20,
      border: `1.5px solid ${selected ? COLORS.green600 : COLORS.border}`,
      background: selected ? COLORS.green50 : "#fff",
      cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
      fontSize: 13, fontWeight: selected ? 600 : 400,
      color: selected ? COLORS.green700 : COLORS.text500,
      transition: "all 0.2s",
    }}>{label}</button>
  );
}

// ─── INLINE CUSTOMIZED ANALYSIS CHAT ─────────────────────────
function CustomizedAnalysisChat({ profile, results }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const winner = results.copay.totalOutOfPocket < results.cdhp.totalOutOfPocket ? "copay" : "cdhp";

  const systemPrompt = `You are a guided benefits advisor for Greenhill School employees. Your job is to refine the user's cost estimate by gathering specific details about their healthcare needs that the basic calculator could not capture.

PLAN DETAILS:

CO-PAY PLAN (PPO):
- Bi-weekly premiums: Employee $71.99, Emp+Children $212.83, Emp+Spouse $529.62, Family $719.20
- Deductible: $1,250 individual / $3,125 family (many services bypass the deductible via copays)
- Out-of-pocket max: $6,750 individual / $13,500 family
- Primary care: $20 copay (no deductible)
- Specialist: $40 copay (no deductible)
- ER: $200 copay (no deductible), waived if admitted
- Urgent care: $75 copay
- Hospital/surgery: 15% coinsurance after deductible
- Mental health outpatient: $20 copay (no deductible)
- Lab/X-ray: $20 copay (no deductible)
- Imaging (CT/MRI): 15% coinsurance after deductible
- Physical therapy: $40 copay (no deductible)
- Rx (NO deductible): Generic $10/$15/$25, Preferred brand $30/$40/$75, Non-preferred $60/$80/$150, Specialty 10%/15%
- FSA available (employee-funded, use-it-or-lose-it, up to $3,300)

CDHP PLAN (with HSA):
- Bi-weekly premiums: Employee $0, Emp+Children $119.68, Emp+Spouse $397.54, Family $476.32
- Deductible: $3,300 individual / $7,500 family (most services require deductible first)
- Out-of-pocket max: $4,100 individual / $10,250 family
- Primary care: No charge AFTER deductible
- Specialist: 5% coinsurance after deductible
- ER: 5% coinsurance after deductible
- Urgent care: 5% coinsurance after deductible
- Hospital/surgery: 5% coinsurance after deductible
- Mental health outpatient: No charge after deductible
- Lab/X-ray: No charge after deductible
- Imaging: 5% coinsurance after deductible
- Physical therapy: 5% coinsurance after deductible
- Rx (AFTER deductible): Generic $5/$10/$10, Preferred brand $20/$30/$50, Non-preferred $40/$60/$100, Specialty 5%/10%
- HSA: Greenhill contributes $1,150 (employee) or $2,300 (with dependents). Employee can contribute up to IRS max. Funds roll over year to year. Pre-tax.
- SurgeryPlus: Covered at no charge after deductible.

Both plans use BCBS PPO network. No referrals needed. Same preventive care (free). CVS Caremark for Rx. Quantum Health care coordinators available free.

USER'S CURRENT PROFILE:
${JSON.stringify(profile, null, 2)}

CURRENT CALCULATOR RESULTS:
Co-Pay Plan estimated total: $${results?.copay?.totalOutOfPocket?.toLocaleString() || "N/A"}
CDHP Plan estimated total: $${results?.cdhp?.totalOutOfPocket?.toLocaleString() || "N/A"}
Currently recommended plan: ${PLANS[winner].name}

INSTRUCTIONS:
You are conducting a guided interview to refine the estimate. Follow this flow:

1. Start by warmly introducing yourself and explaining you will ask 3-5 targeted questions. Then immediately ask the FIRST question about specific medication names and monthly costs (e.g., "What medications do you or your family members take? For each one, do you know the monthly cost or whether it's generic vs brand-name?").

2. After they respond, ask about any planned procedures — surgery type, expected cost range if known, whether it's inpatient or outpatient.

3. Ask about chronic conditions that require ongoing treatment (e.g., diabetes management, asthma, recurring physical therapy).

4. If they indicated pregnancy, ask about pregnancy specifics — likelihood of C-section, any known complications or high-risk factors, expected additional monitoring.

5. After gathering 3-5 pieces of specific information, provide a REVISED cost estimate for BOTH plans. Show:
   - Revised Co-Pay Plan estimated annual cost
   - Revised CDHP Plan estimated annual cost
   - Which plan you now recommend and why
   - A brief explanation of what changed from the original estimate

Be warm, conversational, and jargon-free. Keep responses concise (2-4 paragraphs max). Use plain language.
Do NOT use markdown formatting. Write in plain conversational text.
Always note this is still an estimate and they should contact HR or Quantum Health for official guidance.`;

  const sendMessage = async (messageText) => {
    const userMsg = (messageText || input).trim();
    if (!userMsg || loading) return;
    if (!messageText) setInput("");
    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: systemPrompt,
          messages: apiMessages,
        }),
      });
      const data = await response.json();
      const reply = data.content?.map(b => b.text || "").join("") || "Sorry, I couldn't process that. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "I'm having trouble connecting right now. Please try again in a moment." }]);
    }
    setLoading(false);
  };

  const handleOpen = async () => {
    setIsOpen(true);
    // Automatically send the first message to kick off the guided interview
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: systemPrompt,
          messages: [{ role: "user", content: "Hi, I'd like a more customized analysis of my benefits options." }],
        }),
      });
      const data = await response.json();
      const reply = data.content?.map(b => b.text || "").join("") || "Hello! I'd be happy to help refine your benefits estimate. Could you start by telling me about any medications you or your family members take regularly?";
      setMessages([
        { role: "user", content: "Hi, I'd like a more customized analysis of my benefits options." },
        { role: "assistant", content: reply },
      ]);
    } catch (err) {
      setMessages([
        { role: "user", content: "Hi, I'd like a more customized analysis of my benefits options." },
        { role: "assistant", content: "Hello! I'd be happy to help refine your benefits estimate. Let's start with medications — what prescriptions do you or your family members take regularly? For each one, do you know whether it's a generic or brand-name, and roughly what you pay per month?" },
      ]);
    }
    setLoading(false);
  };

  const suggestedQuestions = [
    "I take Humira for rheumatoid arthritis",
    "I'm planning a knee replacement surgery",
    "I have diabetes and need regular monitoring",
    "My wife is pregnant and it may be high-risk",
  ];

  if (!isOpen) {
    return (
      <div style={{ marginTop: 32, textAlign: "center" }}>
        <button onClick={handleOpen} style={{
          padding: "20px 32px", borderRadius: 16, border: `2px solid ${COLORS.green600}`,
          background: COLORS.green50, cursor: "pointer", width: "100%", maxWidth: 480,
          transition: "all 0.2s",
        }}>
          <div style={{
            fontFamily: "'Libre Baskerville', Georgia, serif",
            fontSize: 17, fontWeight: 700, color: COLORS.green900, marginBottom: 6,
          }}>Want a More Customized Analysis?</div>
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: COLORS.text500, lineHeight: 1.4,
          }}>Answer a few targeted questions to refine your estimate</div>
        </button>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 32, borderRadius: 16, overflow: "hidden",
      border: `1px solid ${COLORS.green600}`,
      background: "#fff",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px", background: COLORS.green900,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.sage} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: "#fff" }}>
            Customized Analysis
          </span>
        </div>
        <button onClick={() => setIsOpen(false)} style={{
          background: "none", border: "none", cursor: "pointer", padding: 4,
          color: COLORS.sage, fontSize: 20, lineHeight: 1,
        }}>×</button>
      </div>

      {/* Messages area */}
      <div ref={chatRef} style={{
        maxHeight: 420, overflowY: "auto", padding: 16,
        display: "flex", flexDirection: "column", gap: 12,
        background: COLORS.cream,
      }}>
        {messages.filter(m => m.role !== "user" || m.content !== "Hi, I'd like a more customized analysis of my benefits options.").map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%", padding: "10px 14px", borderRadius: 12,
            background: m.role === "user" ? COLORS.green700 : "#fff",
            color: m.role === "user" ? "#fff" : COLORS.text700,
            fontFamily: "'DM Sans', sans-serif", fontSize: 13, lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            border: m.role === "assistant" ? `1px solid ${COLORS.border}` : "none",
          }}>{m.content}</div>
        ))}
        {loading && (
          <div style={{
            alignSelf: "flex-start", padding: "10px 14px", borderRadius: 12,
            background: "#fff", fontFamily: "'DM Sans', sans-serif",
            fontSize: 13, color: COLORS.text500,
            border: `1px solid ${COLORS.border}`,
          }}>Thinking...</div>
        )}

        {/* Suggested questions - only show if we have <= 2 messages (just the intro exchange) */}
        {messages.length <= 2 && !loading && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {suggestedQuestions.map((q, i) => (
              <button key={i} onClick={() => sendMessage(q)} style={{
                padding: "8px 14px", borderRadius: 20,
                background: "#fff", border: `1px solid ${COLORS.green600}`,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: 12, color: COLORS.green700, transition: "all 0.2s",
              }}>"{q}"</button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: "12px 16px", borderTop: `1px solid ${COLORS.border}`,
        display: "flex", gap: 8, background: "#fff",
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="Type your answer..."
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 10,
            border: `1px solid ${COLORS.border}`, outline: "none",
            fontFamily: "'DM Sans', sans-serif", fontSize: 13,
            color: COLORS.text900,
          }}
        />
        <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{
          padding: "10px 16px", borderRadius: 10, border: "none",
          background: COLORS.green700, color: "#fff", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
          opacity: loading || !input.trim() ? 0.5 : 1,
        }}>Send</button>
      </div>
    </div>
  );
}

// ─── SPOUSE PLAN COMPARISON ──────────────────────────────────
function SpousePlanComparison({ profile, results }) {
  const [activeTab, setActiveTab] = useState("upload"); // "upload" or "manual"
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [spousePlan, setSpousePlan] = useState(null);
  const [manualForm, setManualForm] = useState({
    planName: "",
    monthlyPremium: "",
    deductible: "",
    oopMax: "",
    copay: "",
    hsaContribution: false,
    hsaAmount: "",
  });

  const winner = results.copay.totalOutOfPocket < results.cdhp.totalOutOfPocket ? "copay" : "cdhp";
  const winnerResult = results[winner];
  const winnerPlan = PLANS[winner];

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    setSpousePlan(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/parse-plan", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Failed to parse plan document");
      const data = await response.json();
      setSpousePlan({
        planName: data.planName || "Spouse's Plan",
        annualPremium: data.monthlyPremium ? data.monthlyPremium * 12 : 0,
        deductible: data.deductible || 0,
        oopMax: data.oopMax || 0,
        copay: data.copay || 0,
        hsaContribution: data.hsaContribution || 0,
      });
    } catch (err) {
      setUploadError("Could not parse the plan document. Please try entering details manually.");
    }
    setUploading(false);
  };

  const handleManualSubmit = () => {
    setSpousePlan({
      planName: manualForm.planName || "Spouse's Plan",
      annualPremium: (parseFloat(manualForm.monthlyPremium) || 0) * 12,
      deductible: parseFloat(manualForm.deductible) || 0,
      oopMax: parseFloat(manualForm.oopMax) || 0,
      copay: parseFloat(manualForm.copay) || 0,
      hsaContribution: manualForm.hsaContribution ? (parseFloat(manualForm.hsaAmount) || 0) : 0,
    });
  };

  const updateManual = (key, val) => setManualForm(f => ({ ...f, [key]: val }));

  // Estimate costs if switching to spouse's plan:
  // Greenhill premium drops to $0, lose Greenhill HSA contribution
  // Use spouse plan's premium + estimated medical costs (rough approximation)
  const spouseEstimatedTotal = spousePlan
    ? spousePlan.annualPremium + winnerResult.estimatedMedicalCosts - spousePlan.hsaContribution
    : null;

  const greenhillEstimatedTotal = winnerResult.totalOutOfPocket;

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    border: `1px solid ${COLORS.border}`, outline: "none",
    fontFamily: "'DM Sans', sans-serif", fontSize: 13,
    color: COLORS.text900,
  };

  const labelStyle = {
    fontFamily: "'DM Sans', sans-serif", fontSize: 13,
    color: COLORS.text700, marginBottom: 4, display: "block",
  };

  return (
    <div style={{
      marginTop: 32, borderRadius: 16, overflow: "hidden",
      border: `1px solid ${COLORS.border}`, background: "#fff",
    }}>
      {/* Header */}
      <div style={{
        padding: "18px 24px", borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <h3 style={{
          fontFamily: "'Libre Baskerville', Georgia, serif",
          fontSize: 17, fontWeight: 700, color: COLORS.green900, margin: 0,
        }}>Compare with Your Spouse's Coverage</h3>
        <p style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 13,
          color: COLORS.text500, margin: "6px 0 0", lineHeight: 1.4,
        }}>
          See if staying on Greenhill or switching to your spouse's plan saves more
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${COLORS.border}` }}>
        {[
          { key: "upload", label: "Upload Plan Document" },
          { key: "manual", label: "Enter Details Manually" },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: "12px 16px", border: "none",
            borderBottom: activeTab === tab.key ? `3px solid ${COLORS.green600}` : "3px solid transparent",
            background: activeTab === tab.key ? COLORS.green50 : "#fff",
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
            color: activeTab === tab.key ? COLORS.green700 : COLORS.text500,
            transition: "all 0.2s",
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 24 }}>
        {activeTab === "upload" && !spousePlan && (
          <div>
            <div style={{
              border: `2px dashed ${COLORS.border}`, borderRadius: 12,
              padding: 32, textAlign: "center", background: COLORS.cream,
              position: "relative",
            }}>
              {uploading ? (
                <div>
                  <div style={{
                    width: 40, height: 40, borderRadius: 20, margin: "0 auto 12px",
                    border: `3px solid ${COLORS.green100}`,
                    borderTopColor: COLORS.green600,
                    animation: "spin 1s linear infinite",
                  }} />
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: COLORS.text500 }}>
                    Analyzing plan document...
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif", fontSize: 14,
                    fontWeight: 600, color: COLORS.text900, marginBottom: 4,
                  }}>Upload your spouse's plan summary (PDF)</div>
                  <div style={{
                    fontFamily: "'DM Sans', sans-serif", fontSize: 12,
                    color: COLORS.text500, marginBottom: 16,
                  }}>We'll extract the key details automatically</div>
                  <label style={{
                    display: "inline-block", padding: "10px 24px", borderRadius: 10,
                    background: COLORS.green700, color: "#fff", cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
                  }}>
                    Choose File
                    <input type="file" accept=".pdf" onChange={handleFileUpload}
                      style={{ display: "none" }} />
                  </label>
                </div>
              )}
            </div>
            {uploadError && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: COLORS.redLight,
                fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.red, lineHeight: 1.5,
              }}>{uploadError}</div>
            )}
          </div>
        )}

        {activeTab === "manual" && !spousePlan && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Plan name</label>
              <input type="text" value={manualForm.planName} onChange={e => updateManual("planName", e.target.value)}
                placeholder="e.g., Aetna PPO" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Monthly premium for adding you</label>
              <input type="number" value={manualForm.monthlyPremium} onChange={e => updateManual("monthlyPremium", e.target.value)}
                placeholder="0" style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Deductible (individual)</label>
                <input type="number" value={manualForm.deductible} onChange={e => updateManual("deductible", e.target.value)}
                  placeholder="0" style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Out-of-pocket max (individual)</label>
                <input type="number" value={manualForm.oopMax} onChange={e => updateManual("oopMax", e.target.value)}
                  placeholder="0" style={inputStyle} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Typical copay for a doctor visit</label>
              <input type="number" value={manualForm.copay} onChange={e => updateManual("copay", e.target.value)}
                placeholder="0" style={inputStyle} />
            </div>
            <div style={{
              background: COLORS.green50, borderRadius: 12, padding: "14px 18px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, color: COLORS.text900 }}>
                  Does the employer contribute to an HSA?
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <ToggleChip selected={manualForm.hsaContribution} label="Yes" onClick={() => updateManual("hsaContribution", true)} />
                <ToggleChip selected={!manualForm.hsaContribution} label="No" onClick={() => updateManual("hsaContribution", false)} />
              </div>
            </div>
            {manualForm.hsaContribution && (
              <div>
                <label style={labelStyle}>Annual HSA employer contribution</label>
                <input type="number" value={manualForm.hsaAmount} onChange={e => updateManual("hsaAmount", e.target.value)}
                  placeholder="0" style={inputStyle} />
              </div>
            )}
            <button onClick={handleManualSubmit} style={{
              padding: "12px 24px", borderRadius: 10, border: "none",
              background: COLORS.green700, color: "#fff", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600,
              alignSelf: "flex-end",
            }}>Compare Plans</button>
          </div>
        )}

        {/* Comparison results */}
        {spousePlan && (
          <div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
              {/* Greenhill option */}
              <div style={{
                flex: 1, minWidth: 220, padding: 20, borderRadius: 14,
                border: `2px solid ${greenhillEstimatedTotal <= spouseEstimatedTotal ? COLORS.green600 : COLORS.border}`,
                position: "relative", background: "#fff",
              }}>
                {greenhillEstimatedTotal <= spouseEstimatedTotal && (
                  <div style={{
                    position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                    background: COLORS.green700, color: "#fff",
                    padding: "3px 14px", borderRadius: 20,
                    fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}>BETTER VALUE</div>
                )}
                <h4 style={{
                  fontFamily: "'Libre Baskerville', Georgia, serif",
                  fontSize: 15, fontWeight: 700, color: COLORS.green900, margin: "4px 0 12px",
                  textAlign: "center",
                }}>Stay on Greenhill ({winnerPlan.shortName})</h4>
                <div style={{
                  textAlign: "center", paddingBottom: 12, marginBottom: 12,
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: COLORS.text500, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                    Estimated Annual Cost
                  </div>
                  <div style={{
                    fontFamily: "'Libre Baskerville', Georgia, serif",
                    fontSize: 26, fontWeight: 700,
                    color: greenhillEstimatedTotal <= spouseEstimatedTotal ? COLORS.green700 : COLORS.text900,
                  }}>${greenhillEstimatedTotal.toLocaleString()}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    ["Annual premiums", `$${winnerResult.annualPremium.toLocaleString()}`],
                    ["Deductible", `$${winnerResult.deductible.toLocaleString()}`],
                    ["OOP max", `$${winnerResult.oopMax.toLocaleString()}`],
                    ...(winnerResult.hsaContribution > 0 ? [["HSA contribution", `−$${winnerResult.hsaContribution.toLocaleString()}`]] : []),
                  ].map(([label, val], i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between",
                      fontFamily: "'DM Sans', sans-serif", fontSize: 12,
                    }}>
                      <span style={{ color: COLORS.text500 }}>{label}</span>
                      <span style={{ fontWeight: 600, color: label.includes("HSA") ? COLORS.green600 : COLORS.text900 }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Spouse option */}
              <div style={{
                flex: 1, minWidth: 220, padding: 20, borderRadius: 14,
                border: `2px solid ${spouseEstimatedTotal < greenhillEstimatedTotal ? COLORS.green600 : COLORS.border}`,
                position: "relative", background: "#fff",
              }}>
                {spouseEstimatedTotal < greenhillEstimatedTotal && (
                  <div style={{
                    position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                    background: COLORS.green700, color: "#fff",
                    padding: "3px 14px", borderRadius: 20,
                    fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}>BETTER VALUE</div>
                )}
                <h4 style={{
                  fontFamily: "'Libre Baskerville', Georgia, serif",
                  fontSize: 15, fontWeight: 700, color: COLORS.green900, margin: "4px 0 12px",
                  textAlign: "center",
                }}>Switch to {spousePlan.planName}</h4>
                <div style={{
                  textAlign: "center", paddingBottom: 12, marginBottom: 12,
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: COLORS.text500, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
                    Estimated Annual Cost
                  </div>
                  <div style={{
                    fontFamily: "'Libre Baskerville', Georgia, serif",
                    fontSize: 26, fontWeight: 700,
                    color: spouseEstimatedTotal < greenhillEstimatedTotal ? COLORS.green700 : COLORS.text900,
                  }}>${Math.round(spouseEstimatedTotal).toLocaleString()}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    ["Annual premiums", `$${spousePlan.annualPremium.toLocaleString()}`],
                    ["Deductible", `$${spousePlan.deductible.toLocaleString()}`],
                    ["OOP max", `$${spousePlan.oopMax.toLocaleString()}`],
                    ...(spousePlan.hsaContribution > 0 ? [["HSA contribution", `−$${spousePlan.hsaContribution.toLocaleString()}`]] : []),
                  ].map(([label, val], i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between",
                      fontFamily: "'DM Sans', sans-serif", fontSize: 12,
                    }}>
                      <span style={{ color: COLORS.text500 }}>{label}</span>
                      <span style={{ fontWeight: 600, color: label.includes("HSA") ? COLORS.green600 : COLORS.text900 }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Note about trade-offs */}
            <div style={{
              padding: 14, borderRadius: 10, background: COLORS.blueLight,
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.blue, lineHeight: 1.6,
            }}>
              <strong>Keep in mind:</strong> If you switch to your spouse's plan, your Greenhill premium drops to $0
              but you lose the Greenhill HSA contribution
              {winnerResult.hsaContribution > 0 ? ` ($${winnerResult.hsaContribution.toLocaleString()}/year)` : ""}.
              The medical cost estimate above uses the same usage profile you entered.
              Actual costs on the spouse's plan will depend on their specific copays, coinsurance rates, and network.
            </div>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button onClick={() => setSpousePlan(null)} style={{
                padding: "8px 20px", borderRadius: 8, border: `1px solid ${COLORS.border}`,
                background: "#fff", cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.text500,
              }}>Re-enter spouse plan details</button>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── RESULTS VIEW ────────────────────────────────────────────
function ResultsView({ profile, onRestart }) {
  const copayResult = estimateAnnualCost(profile, "copay");
  const cdhpResult = estimateAnnualCost(profile, "cdhp");
  const results = { copay: copayResult, cdhp: cdhpResult };
  const winner = copayResult.totalOutOfPocket < cdhpResult.totalOutOfPocket ? "copay" : "cdhp";
  const savings = Math.abs(copayResult.totalOutOfPocket - cdhpResult.totalOutOfPocket);

  const tierLabel = { employee: "Employee Only", empChildren: "Employee + Child(ren)", empSpouse: "Employee + Spouse", family: "Employee + Family" }[profile.coverageTier];

  const PlanCard = ({ planKey, result, isWinner }) => {
    const plan = PLANS[planKey];
    return (
      <div style={{
        flex: 1, minWidth: 250, padding: 24, borderRadius: 16,
        background: isWinner ? "#fff" : "#fff",
        border: `2px solid ${isWinner ? COLORS.green600 : COLORS.border}`,
        position: "relative",
      }}>
        {isWinner && (
          <div style={{
            position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)",
            background: COLORS.green700, color: "#fff",
            padding: "4px 16px", borderRadius: 20,
            fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700,
            letterSpacing: 0.5, whiteSpace: "nowrap",
          }}>✓ RECOMMENDED FOR YOU</div>
        )}
        <h3 style={{
          fontFamily: "'Libre Baskerville', Georgia, serif",
          fontSize: 18, fontWeight: 700, color: COLORS.green900,
          margin: "8px 0 16px", textAlign: "center",
        }}>{plan.shortName} Plan</h3>

        <div style={{
          textAlign: "center", padding: "16px 0", marginBottom: 16,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 11,
            color: COLORS.text500, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4,
          }}>Estimated Annual Cost</div>
          <div style={{
            fontFamily: "'Libre Baskerville', Georgia, serif",
            fontSize: 32, fontWeight: 700,
            color: isWinner ? COLORS.green700 : COLORS.text900,
          }}>${result.totalOutOfPocket.toLocaleString()}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            ["Premiums (annual)", `$${result.annualPremium.toLocaleString()}`],
            ["Est. medical costs", `$${result.estimatedMedicalCosts.toLocaleString()}`],
            ...(result.hsaContribution > 0 ? [["Greenhill HSA contribution", `−$${result.hsaContribution.toLocaleString()}`]] : []),
            ["Deductible", `$${result.deductible.toLocaleString()}`],
            ["Out-of-pocket max", `$${result.oopMax.toLocaleString()}`],
          ].map(([label, val], i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13,
            }}>
              <span style={{ color: COLORS.text500 }}>{label}</span>
              <span style={{
                fontWeight: 600, color: label.includes("HSA") ? COLORS.green600 : COLORS.text900,
              }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const prosConsCopay = [];
  const prosConsCdhp = [];

  // Build contextual pros/cons
  if (copayResult.annualPremium > cdhpResult.annualPremium) {
    prosConsCdhp.push({ type: "pro", text: `Save $${(copayResult.annualPremium - cdhpResult.annualPremium).toLocaleString()}/year in premiums` });
    prosConsCopay.push({ type: "con", text: `Higher premiums: $${copayResult.annualPremium.toLocaleString()}/year` });
  }

  prosConsCopay.push({ type: "pro", text: "Predictable copays — you know what each visit costs upfront" });
  prosConsCopay.push({ type: "pro", text: "Many services bypass the deductible entirely" });
  prosConsCopay.push({ type: "pro", text: "Prescriptions covered immediately (no deductible)" });
  prosConsCopay.push({ type: "con", text: "Higher out-of-pocket max ($6,750 individual)" });
  prosConsCopay.push({ type: "con", text: "No employer HSA contribution" });
  prosConsCopay.push({ type: "con", text: "FSA funds don't roll over (use-it-or-lose-it)" });

  prosConsCdhp.push({ type: "pro", text: `Greenhill contributes $${(profile.coverageTier === "employee" ? "1,150" : "2,300")} to your HSA` });
  prosConsCdhp.push({ type: "pro", text: "HSA funds roll over year to year and grow tax-free" });
  prosConsCdhp.push({ type: "pro", text: "Lower out-of-pocket max ($4,100 individual)" });
  prosConsCdhp.push({ type: "pro", text: "Very low coinsurance (5%) once deductible is met" });
  prosConsCdhp.push({ type: "con", text: "Higher deductible ($3,300) — you pay full cost until met" });
  prosConsCdhp.push({ type: "con", text: "Prescriptions count toward deductible first" });
  if (profile.primaryCareVisits + profile.specialistVisits > 8) {
    prosConsCdhp.push({ type: "con", text: "With frequent visits, you'll likely hit the deductible" });
  }

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 20px", animation: "fadeIn 0.5s ease" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h2 style={{
          fontFamily: "'Libre Baskerville', Georgia, serif",
          fontSize: 24, fontWeight: 700, color: COLORS.green900, margin: "0 0 8px",
        }}>Your Plan Comparison</h2>
        <p style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 14,
          color: COLORS.text500, margin: 0,
        }}>Based on your {tierLabel} coverage and estimated healthcare usage</p>
      </div>

      {/* Savings callout */}
      <div style={{
        padding: "16px 24px", borderRadius: 12,
        background: COLORS.green50, border: `1px solid ${COLORS.sage}`,
        textAlign: "center", marginBottom: 28,
      }}>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 15, color: COLORS.green900 }}>
          The <strong>{PLANS[winner].shortName} Plan</strong> could save you approximately{" "}
          <strong style={{ color: COLORS.green600 }}>${savings.toLocaleString()}</strong> this year
        </span>
      </div>

      {/* Plan cards */}
      <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
        <PlanCard planKey="copay" result={copayResult} isWinner={winner === "copay"} />
        <PlanCard planKey="cdhp" result={cdhpResult} isWinner={winner === "cdhp"} />
      </div>

      {/* Pros & Cons */}
      <div style={{ display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
        {[
          { key: "copay", label: "Co-Pay Plan", items: prosConsCopay },
          { key: "cdhp", label: "CDHP Plan", items: prosConsCdhp },
        ].map(({ key, label, items }) => (
          <div key={key} style={{ flex: 1, minWidth: 250 }}>
            <h4 style={{
              fontFamily: "'Libre Baskerville', Georgia, serif",
              fontSize: 15, fontWeight: 700, color: COLORS.green900, margin: "0 0 12px",
            }}>{label}</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item, i) => (
                <div key={i} style={{
                  display: "flex", gap: 8, alignItems: "flex-start",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: COLORS.text700,
                  lineHeight: 1.4,
                }}>
                  <span style={{
                    flexShrink: 0, marginTop: 1,
                    color: item.type === "pro" ? COLORS.green600 : COLORS.red,
                    fontSize: 14,
                  }}>{item.type === "pro" ? "✓" : "✗"}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Disclaimer */}
      <div style={{
        padding: 16, borderRadius: 10, background: COLORS.goldLight,
        fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.text700,
        lineHeight: 1.6, marginBottom: 24,
      }}>
        <strong>Important:</strong> These are estimates based on average healthcare costs and the information you provided.
        Actual costs will vary depending on providers, specific treatments, and negotiated rates.
        For personalized guidance, contact Quantum Health at 1-877-225-2981 or speak with HR.
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 0 }}>
        <button onClick={onRestart} style={{
          padding: "12px 28px", borderRadius: 10, border: `1px solid ${COLORS.border}`,
          background: "#fff", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 500, color: COLORS.text500,
        }}>Start Over</button>
      </div>

      {/* Spouse Plan Comparison — only shown when spouse coverage is indicated */}
      {profile.hasSpouseCoverage && (
        <SpousePlanComparison profile={profile} results={results} />
      )}

      {/* Inline Customized Analysis Chat */}
      <CustomizedAnalysisChat profile={profile} results={results} />

      <div style={{ height: 60 }} />
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState({
    coverageTier: "",
    householdHealth: "moderate",
    primaryCareVisits: 2,
    specialistVisits: 1,
    erVisits: 0,
    urgentCareVisits: 0,
    labVisits: 1,
    imagingScans: 0,
    mentalHealthVisits: 0,
    physicalTherapyVisits: 0,
    genericMeds: 0,
    brandMeds: 0,
    nonPreferredMeds: 0,
    specialtyMeds: 0,
    expectingBaby: false,
    expectingSurgery: false,
    hospitalDays: 0,
    riskPreference: "",
    hasSpouseCoverage: false,
  });

  const update = (key, val) => setProfile(p => ({ ...p, [key]: val }));
  const TOTAL_STEPS = 8;

  const applyHealthTemplate = useCallback((level) => {
    update("householdHealth", level);
    if (level === "healthy") {
      setProfile(p => ({ ...p, householdHealth: level, primaryCareVisits: 1, specialistVisits: 0, erVisits: 0, urgentCareVisits: 0, labVisits: 1, imagingScans: 0, mentalHealthVisits: 0, physicalTherapyVisits: 0, genericMeds: 0, brandMeds: 0, nonPreferredMeds: 0, specialtyMeds: 0 }));
    } else if (level === "moderate") {
      setProfile(p => ({ ...p, householdHealth: level, primaryCareVisits: 3, specialistVisits: 2, erVisits: 0, urgentCareVisits: 1, labVisits: 2, imagingScans: 0, mentalHealthVisits: 0, physicalTherapyVisits: 0, genericMeds: 1, brandMeds: 0, nonPreferredMeds: 0, specialtyMeds: 0 }));
    } else {
      setProfile(p => ({ ...p, householdHealth: level, primaryCareVisits: 6, specialistVisits: 5, erVisits: 1, urgentCareVisits: 2, labVisits: 4, imagingScans: 1, mentalHealthVisits: 0, physicalTherapyVisits: 4, genericMeds: 2, brandMeds: 1, nonPreferredMeds: 0, specialtyMeds: 0 }));
    }
  }, []);

  if (step === TOTAL_STEPS) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.cream, paddingTop: 20, paddingBottom: 80 }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=DM+Sans:wght@400;500;600;700&display=swap');
          @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
          * { box-sizing: border-box; }
          input::placeholder { color: ${COLORS.text300}; }
        `}</style>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 20px 12px" }}>
          <GreenhillLogo size={30} />
        </div>
        <ResultsView profile={profile} onRestart={() => { setStep(0); }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.cream, display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        input::placeholder { color: ${COLORS.text300}; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "20px 24px 16px", maxWidth: 600, margin: "0 auto", width: "100%" }}>
        <GreenhillLogo size={30} />
      </div>

      {step > 0 && (
        <div style={{ maxWidth: 560, margin: "0 auto 20px", width: "100%", padding: "0 20px" }}>
          <ProgressBar step={step} totalSteps={TOTAL_STEPS} />
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: COLORS.text300,
            marginTop: 6, textAlign: "right",
          }}>Step {step} of {TOTAL_STEPS}</div>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: step === 0 ? "center" : "flex-start" }}>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div style={{
            maxWidth: 520, margin: "0 auto", padding: "0 20px", textAlign: "center",
            animation: "fadeIn 0.5s ease",
          }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20, margin: "0 auto 24px",
              background: `linear-gradient(135deg, ${COLORS.sage}, ${COLORS.green600})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 36,
            }}>🏥</div>
            <h1 style={{
              fontFamily: "'Libre Baskerville', Georgia, serif",
              fontSize: 26, fontWeight: 700, color: COLORS.green900,
              margin: "0 0 12px", lineHeight: 1.3,
            }}>Benefits Plan Advisor</h1>
            <p style={{
              fontFamily: "'DM Sans', sans-serif", fontSize: 15,
              color: COLORS.text500, margin: "0 0 8px", lineHeight: 1.6,
            }}>
              Find the right healthcare plan for you and your family.
              We'll ask a few questions about how you use healthcare
              and show you a personalized cost comparison.
            </p>
            <p style={{
              fontFamily: "'DM Sans', sans-serif", fontSize: 13,
              color: COLORS.text300, margin: "0 0 32px", lineHeight: 1.5,
            }}>
              Takes about 3 minutes · No exact numbers needed · Your answers stay in your browser
            </p>
            <button onClick={() => setStep(1)} style={{
              padding: "14px 40px", borderRadius: 12, border: "none",
              background: COLORS.green700, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600, color: "#fff",
              boxShadow: `0 4px 12px rgba(27,60,40,0.2)`,
            }}>Get Started</button>
          </div>
        )}

        {/* Step 1: Coverage Tier */}
        {step === 1 && (
          <StepContainer
            title="Who will be covered?"
            subtitle="Select the coverage tier that fits your household. All family members must be on the same plan."
            onNext={() => setStep(2)}
            nextDisabled={!profile.coverageTier}
            step={1}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <OptionCard selected={profile.coverageTier === "employee"} onClick={() => update("coverageTier", "employee")}
                icon="👤" title="Just Me" subtitle="Employee only" />
              <OptionCard selected={profile.coverageTier === "empChildren"} onClick={() => update("coverageTier", "empChildren")}
                icon="👨‍👧‍👦" title="Me + My Child(ren)" subtitle="Employee + dependent children" />
              <OptionCard selected={profile.coverageTier === "empSpouse"} onClick={() => update("coverageTier", "empSpouse")}
                icon="👫" title="Me + My Spouse" subtitle="Employee + spouse/partner" />
              <OptionCard selected={profile.coverageTier === "family"} onClick={() => update("coverageTier", "family")}
                icon="👨‍👩‍👧‍👦" title="My Whole Family" subtitle="Employee + spouse + child(ren)" recommended />
            </div>
          </StepContainer>
        )}

        {/* Step 2: Health Snapshot */}
        {step === 2 && (
          <StepContainer
            title="How would you describe your household's healthcare use?"
            subtitle="Think about a typical year. Don't worry about being exact — we'll fine-tune in the next steps."
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
            step={2}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <OptionCard selected={profile.householdHealth === "healthy"} onClick={() => applyHealthTemplate("healthy")}
                icon="💪" title="Healthy & Low Use"
                subtitle="Annual checkup, maybe 1 sick visit. Rarely need prescriptions." />
              <OptionCard selected={profile.householdHealth === "moderate"} onClick={() => applyHealthTemplate("moderate")}
                icon="🩺" title="Moderate Use"
                subtitle="A few doctor visits a year, maybe a specialist. 1-2 ongoing meds." recommended />
              <OptionCard selected={profile.householdHealth === "high"} onClick={() => applyHealthTemplate("high")}
                icon="🏥" title="High Use or Chronic Conditions"
                subtitle="Frequent visits, multiple specialists, several medications, ongoing therapy." />
            </div>
          </StepContainer>
        )}

        {/* Step 3: Visit Details */}
        {step === 3 && (
          <StepContainer
            title="Let's get more specific about visits"
            subtitle="Estimate total visits across all covered family members for the year. Use your best guess."
            onNext={() => setStep(4)}
            onBack={() => setStep(2)}
            step={3}
          >
            <div style={{
              background: "#fff", borderRadius: 12, padding: "4px 16px",
              border: `1px solid ${COLORS.border}`,
            }}>
              <CounterInput label="Primary care / doctor visits" value={profile.primaryCareVisits} onChange={v => update("primaryCareVisits", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Specialist visits" value={profile.specialistVisits} onChange={v => update("specialistVisits", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Urgent care visits" value={profile.urgentCareVisits} onChange={v => update("urgentCareVisits", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="ER visits" value={profile.erVisits} onChange={v => update("erVisits", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Lab work / blood draws" value={profile.labVisits} onChange={v => update("labVisits", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Imaging (CT, MRI, X-ray)" value={profile.imagingScans} onChange={v => update("imagingScans", v)} />
            </div>
          </StepContainer>
        )}

        {/* Step 4: Mental Health & PT */}
        {step === 4 && (
          <StepContainer
            title="Therapy & rehabilitation"
            subtitle="These services are covered differently between the two plans."
            onNext={() => setStep(5)}
            onBack={() => setStep(3)}
            step={4}
          >
            <div style={{
              background: "#fff", borderRadius: 12, padding: "4px 16px",
              border: `1px solid ${COLORS.border}`,
            }}>
              <CounterInput label="Mental health / therapy visits per year" value={profile.mentalHealthVisits} onChange={v => update("mentalHealthVisits", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Physical therapy visits per year" value={profile.physicalTherapyVisits} onChange={v => update("physicalTherapyVisits", v)} />
            </div>
            <div style={{
              marginTop: 12, padding: 12, borderRadius: 8,
              background: COLORS.blueLight,
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.blue, lineHeight: 1.5,
            }}>
              💡 <strong>Tip:</strong> The Co-Pay plan charges $20/visit for therapy with no deductible.
              The CDHP covers therapy at no charge, but only after you've met the $3,300 deductible.
            </div>
          </StepContainer>
        )}

        {/* Step 5: Prescriptions */}
        {step === 5 && (
          <StepContainer
            title="Prescription medications"
            subtitle="Count the number of ongoing monthly medications for everyone on the plan. Don't include short-term prescriptions like antibiotics."
            onNext={() => setStep(6)}
            onBack={() => setStep(4)}
            step={5}
          >
            <div style={{
              background: "#fff", borderRadius: 12, padding: "4px 16px",
              border: `1px solid ${COLORS.border}`,
            }}>
              <CounterInput label="Generic medications" value={profile.genericMeds} onChange={v => update("genericMeds", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Brand-name (preferred) medications" value={profile.brandMeds} onChange={v => update("brandMeds", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Brand-name (non-preferred)" value={profile.nonPreferredMeds} onChange={v => update("nonPreferredMeds", v)} />
              <div style={{ borderTop: `1px solid ${COLORS.border}` }} />
              <CounterInput label="Specialty medications" value={profile.specialtyMeds} onChange={v => update("specialtyMeds", v)} max={5} />
            </div>
            <div style={{
              marginTop: 12, padding: 12, borderRadius: 8,
              background: COLORS.blueLight,
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.blue, lineHeight: 1.5,
            }}>
              💡 <strong>Not sure about tiers?</strong> Most common medications (metformin, lisinopril, etc.) are generic.
              If you're unsure, check <a href="https://www.caremark.com" target="_blank" style={{ color: COLORS.blue }}>caremark.com</a> or ask the chat advisor after you see your results.
            </div>
          </StepContainer>
        )}

        {/* Step 6: Major Events */}
        {step === 6 && (
          <StepContainer
            title="Any big events coming up?"
            subtitle="Major medical events can significantly shift which plan is more cost-effective."
            onNext={() => setStep(7)}
            onBack={() => setStep(5)}
            step={6}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{
                background: "#fff", borderRadius: 12, padding: "16px 20px",
                border: `1px solid ${COLORS.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: COLORS.text900 }}>
                    🤰 Expecting a baby?
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.text500, marginTop: 2 }}>
                    Pregnancy, delivery, and postpartum care
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ToggleChip selected={profile.expectingBaby} label="Yes" onClick={() => update("expectingBaby", true)} />
                  <ToggleChip selected={!profile.expectingBaby} label="No" onClick={() => update("expectingBaby", false)} />
                </div>
              </div>

              <div style={{
                background: "#fff", borderRadius: 12, padding: "16px 20px",
                border: `1px solid ${COLORS.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: COLORS.text900 }}>
                    🔧 Expecting a surgery?
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.text500, marginTop: 2 }}>
                    Planned outpatient or inpatient procedure
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ToggleChip selected={profile.expectingSurgery} label="Yes" onClick={() => update("expectingSurgery", true)} />
                  <ToggleChip selected={!profile.expectingSurgery} label="No" onClick={() => update("expectingSurgery", false)} />
                </div>
              </div>

              <div style={{
                background: "#fff", borderRadius: 12, padding: "16px 20px",
                border: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: COLORS.text900 }}>
                      🛏️ Expected hospital stays?
                    </div>
                    <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.text500, marginTop: 2 }}>
                      Nights in the hospital (not including delivery)
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => update("hospitalDays", Math.max(0, profile.hospitalDays - 1))} style={{
                      width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`,
                      background: "#fff", cursor: "pointer", fontSize: 18, color: COLORS.text500,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>−</button>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600, width: 24, textAlign: "center" }}>
                      {profile.hospitalDays}
                    </span>
                    <button onClick={() => update("hospitalDays", Math.min(30, profile.hospitalDays + 1))} style={{
                      width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`,
                      background: "#fff", cursor: "pointer", fontSize: 18, color: COLORS.text500,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>+</button>
                  </div>
                </div>
              </div>
            </div>
          </StepContainer>
        )}

        {/* Step 7: Preference & Spouse */}
        {step === 7 && (
          <StepContainer
            title="A couple more things..."
            subtitle="These help us refine the recommendation."
            onNext={() => setStep(8)}
            onBack={() => setStep(6)}
            nextLabel="See My Results"
            step={7}
          >
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600,
                color: COLORS.text900, marginBottom: 10,
              }}>What matters more to you?</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <OptionCard selected={profile.riskPreference === "predictability"} onClick={() => update("riskPreference", "predictability")}
                  icon="🎯" title="Predictable costs"
                  subtitle="I'd rather know what I'm paying each visit, even if premiums are higher" />
                <OptionCard selected={profile.riskPreference === "savings"} onClick={() => update("riskPreference", "savings")}
                  icon="💰" title="Lowest total cost"
                  subtitle="I'm comfortable with a higher deductible if it saves me money overall" />
                <OptionCard selected={profile.riskPreference === "unsure"} onClick={() => update("riskPreference", "unsure")}
                  icon="🤷" title="Not sure — just show me the numbers"
                  subtitle="I'll decide based on the comparison" />
              </div>
            </div>

            {(profile.coverageTier === "empSpouse" || profile.coverageTier === "family") && (
              <div style={{
                background: "#fff", borderRadius: 12, padding: "16px 20px",
                border: `1px solid ${COLORS.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 600, color: COLORS.text900 }}>
                    Does your spouse have their own employer coverage?
                  </div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: COLORS.text500, marginTop: 2 }}>
                    You can explore this with the chat advisor after seeing results
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ToggleChip selected={profile.hasSpouseCoverage} label="Yes" onClick={() => update("hasSpouseCoverage", true)} />
                  <ToggleChip selected={!profile.hasSpouseCoverage} label="No" onClick={() => update("hasSpouseCoverage", false)} />
                </div>
              </div>
            )}
          </StepContainer>
        )}
      </div>
    </div>
  );
}
