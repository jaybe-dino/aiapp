// 렌탈 리드(설치 상담 신청) — 연락처·주소를 암호화 저장하고 제휴사에 전달할 클릭을 생성.
// 개인정보 목적제한: third_party 동의 필수, 저장은 암호화, 조회는 마스킹 기본.
import { db } from "../../db/index.js";
import { id, now } from "../../lib/id.js";
import { Problems } from "../../lib/problem.js";
import { encryptField, decryptField, maskName, maskPhone } from "../../lib/crypto.js";
import { str } from "../../lib/validate.js";
import { hasConsent } from "../auth/auth.js";
import { getOfferSnapshot, createClick } from "./commercial.js";

export interface LeadInput {
  name: string;
  phone: string;
  address: string;
  preferredTime?: string;
}

export function submitRentalLead(userId: string, offerSnapshotId: string, input: LeadInput): {
  leadId: string;
  clickId: string;
  advertiserName: string;
} {
  const offer = getOfferSnapshot(offerSnapshotId);
  if (!offer) throw Problems.notFound("혜택");
  if (!offer.isRental) throw Problems.badRequest("렌탈 상품이 아닙니다.");
  // 제3자 제공 동의 필수(연락처·주소 전달)
  if (!hasConsent(userId, "third_party")) {
    throw Problems.conflict("개인정보 제3자 제공 동의가 필요합니다.");
  }

  const name = str(input.name, "이름", { min: 2, max: 30 });
  const phoneRaw = str(input.phone, "연락처", { min: 9, max: 20 });
  if (!/^01[0-9]{8,9}$/.test(phoneRaw.replace(/\D/g, ""))) throw Problems.badRequest("휴대폰 번호 형식이 올바르지 않습니다.");
  const address = str(input.address, "설치 주소", { min: 5, max: 120 });
  const preferredTime = input.preferredTime ? str(input.preferredTime, "희망 시간", { max: 40 }) : null;

  // 제휴사로 이동할 클릭 생성(귀속·전환 근거)
  const click = createClick({ userId, offerSnapshotId });
  if (!click) throw Problems.notFound("혜택");

  const leadId = id("led");
  db.prepare(
    `INSERT INTO rental_leads (lead_id, user_id, offer_id, offer_snapshot_id, advertiser_name, click_id, name_enc, phone_enc, address_enc, preferred_time, consent_purpose, data_sharing, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'third_party', ?, 'submitted', ?)`
  ).run(
    leadId, userId, offer.offerId, offerSnapshotId, offer.advertiserName, click.clickId,
    encryptField(name), encryptField(phoneRaw), encryptField(address), preferredTime, offer.dataSharing, now()
  );

  return { leadId, clickId: click.clickId, advertiserName: offer.advertiserName };
}

export function listLeadsForUser(userId: string) {
  const rows = db.prepare("SELECT lead_id, advertiser_name, status, preferred_time, created_at FROM rental_leads WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  return rows;
}

// 운영자 조회: 기본 마스킹. 실 전달(제휴사 연동)에서만 복호화하며 감사 로그 필요.
export function listLeadsMasked(limit = 100) {
  const rows = db.prepare("SELECT * FROM rental_leads ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
  return rows.map((r) => ({
    lead_id: r.lead_id,
    advertiser_name: r.advertiser_name,
    name: maskName(safeDecrypt(r.name_enc)),
    phone: maskPhone(safeDecrypt(r.phone_enc)),
    address: safeDecrypt(r.address_enc).replace(/(\S{3})\S+/, "$1***"),
    preferred_time: r.preferred_time,
    status: r.status,
    data_sharing: r.data_sharing,
    created_at: r.created_at,
  }));
}

function safeDecrypt(v: string): string {
  try { return decryptField(v); } catch { return ""; }
}
