"""Build a truthful review PDF; no secrets, wallet actions or network access."""
from pathlib import Path
from hashlib import sha256
from json import loads
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/pdf/C-Market-C3-Review-Pitch.pdf"
MANIFEST = loads((ROOT / "submission/c3-mainnet-pilot-candidate.json").read_text())
PUBLIC = loads((ROOT / "submission/c3-public-identities.json").read_text())
ASSETS = ROOT / MANIFEST["artifactDirectory"]
APK = ASSETS / MANIFEST["apk"]["file"]
if sha256(APK.read_bytes()).hexdigest() != MANIFEST["apk"]["sha256"]:
    raise RuntimeError("APK hash mismatch; do not create a misleading pitch")
FONT_DIR = Path("/Users/juantorres/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/standard_fonts")
pdfmetrics.registerFont(TTFont("C3", str(FONT_DIR / "LiberationSans-Regular.ttf")))
pdfmetrics.registerFont(TTFont("C3B", str(FONT_DIR / "LiberationSans-Bold.ttf")))
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(OUTPUT), pagesize=(960, 540), invariant=1)
c.setTitle("C Market C3 - restricted pilot review, Mainnet pending")
c.setAuthor("C Market")
BG, PANEL, GREEN, LIGHT, MUTED, AMBER = map(HexColor, ["#071B16", "#11352B", "#79DEAC", "#EFF9F4", "#AAC9BD", "#FFC56A"])
styles = {
    "body": ParagraphStyle("body", fontName="C3", fontSize=18, leading=26, textColor=LIGHT),
    "small": ParagraphStyle("small", fontName="C3", fontSize=12, leading=18, textColor=MUTED),
    "card": ParagraphStyle("card", fontName="C3B", fontSize=22, leading=28, textColor=GREEN),
}
def text(value, x, y, width, style="body"):
    p = Paragraph(value, styles[style]); _, height = p.wrap(width, 400)
    if y - height < 66:
        raise RuntimeError("Text exceeds page safe area")
    p.drawOn(c, x, y - height)
    return y - height

def page(n, title, subtitle):
    c.setFillColor(BG); c.rect(0, 0, 960, 540, stroke=0, fill=1)
    c.setFillColor(GREEN); c.setFont("C3B", 16); c.drawString(42, 502, "C MARKET / C3")
    c.setFillColor(AMBER); c.setFont("C3B", 10); c.drawRightString(918, 502, "REVIEW DRAFT - MAINNET NOT ACCEPTED")
    c.setFillColor(LIGHT); c.setFont("C3B", 31); c.drawString(42, 444, title)
    text(subtitle, 42, 420, 876, "small")
    c.setFillColor(MUTED); c.setFont("C3", 10)
    c.drawString(42, 26, "5 October 2026 | Local evidence is not Mainnet asset acquisition | No guaranteed return")
    c.drawRightString(918, 26, f"{n} / 6")

page(1, "A transparent basket on Seeker", "Restricted C3 pilot candidate: buy, verify ownership, sell and claim realized USDC.")
logo = ROOT / "apps/identity/cmarket-wordmark.png"
c.drawImage(str(logo), 42, 266, width=350, height=130, preserveAspectRatio=True, anchor="c", mask="auto")
text("40% cbBTC<br/>30% Portal ETH<br/>30% WSOL in PDA custody", 505, 361, 395, "card")
text("One allowlisted wallet. Exactly one lifetime deposit of 1 USDC per vault. Full redemption only. No active C Market fees or SKR rewards.", 42, 188, 850)
c.showPage()

page(2, "Ownership, not a treasury payment", "The existing architecture keeps underlying assets in program-controlled vault accounts.")
steps = ["Explicit MWA deposit", "Three constrained Jupiter buys", "On-chain shares and position", "Three sales, burn and USDC claim"]
for i, label in enumerate(steps):
    x = 42 + i * 222
    c.setFillColor(PANEL); c.roundRect(x, 220, 207, 158, 14, stroke=0, fill=1)
    text(str(i + 1), x + 18, 361, 168, "card")
    text(label, x + 18, 315, 168)
text("MWA authorizes the owner's wallet. The keeper cannot sign for the user. Selling returns the USDC actually realized, not a promised 1 USDC.", 42, 180, 876)
c.showPage()

page(3, "What is verified today", "Evidence: preserved PostgreSQL / local validator cycle and signed disabled Android candidate.")
text("LOCAL: six actual cloned Jupiter CPI legs; sell inputs came from the same run's acquired inventory. 1,000,000 share units minted and burned; 0.997766 synthetic USDC returned. Duplicate claim rejected.", 42, 369, 860)
text("ANDROID: compatible candidate install and cold launch without Metro. Mainnet execution remains disabled. Physical Phantom return and owner signature are NOT verified.", 42, 249, 860)
text("NOT VERIFIED: Mainnet deposit, real asset acquisition, shares, sale or receipt. HTTPS service and isolated production signer have not been provisioned.", 42, 141, 860, "small")
c.showPage()

page(4, "Recovery preserves rights", "Price movement cannot silently reduce an already committed minimum.")
text("An explicit owner review binds fresh Jupiter output, threshold, slippage, expiry, plan hash and revision. Only the next pending leg can change. Old authorizations cannot execute the new generation.", 42, 367, 860)
text("Signatures persist before one send attempt. Uncertain operations require reconciliation of that same signature, never automatic re-signing or resend. Two independently operated RPC providers must agree on finalized effects.", 42, 247, 860)
text("Scoped independent agent review and regression tests are not a professional external audit or governance approval. Outstanding supply-chain/tooling warnings remain disclosed.", 42, 124, 860, "small")
c.showPage()

page(5, "Concrete release, still blocked", "Hashes identify the current disabled candidate; a reviewed enabled build requires its own approval.")
text("APK SHA-256: " + escape(MANIFEST["apk"]["sha256"]), 42, 370, 875, "small")
text("ELF SHA-256: " + escape(MANIFEST["program"]["sha256"]), 42, 320, 875, "small")
text("Known disabled-binary proposal: 6.947558160 SOL plus separate 1 USDC. This is NOT the total cost or approved funding. Monthly infrastructure subtotals: USD 110.80 / USD 155.80 with HA; signer hardening, variable fees and other costs remain unpriced.", 42, 265, 868)
text("Owner-selected domain: dominaweb3.com. Proposed API/signing subdomains, newly generated public identities, authority decisions and budget ceilings require review. No services or Mainnet accounts have been created.", 42, 134, 868, "small")
c.showPage()

page(6, "The final acceptance gate", "Do not present the local cycle as the user's real position or a Mainnet purchase.")
text("1. Approve exact authorities, configuration, artifact hashes and complete spending caps.<br/>2. Provision isolated services and verify restoration, TLS and independent RPC evidence.<br/>3. After explicit deployment approval, verify the deployed program and limits.<br/>4. On Seeker, the owner approves the actual 1 USDC deposit and redemption; verify custody, shares, burn and USDC receipt.", 42, 370, 860)
text("Manual submission still needs team details, published source/APK links, a recording of the accepted flow and final pitch. Current portal deadline timezone is unverified; no submission was sent.", 42, 154, 868, "small")
text("Sources: github.com/dominaweb3-art/cmarket-clock-in | solanamobile.radiant.nexus | submission/c3-mainnet-pilot-candidate.json", 42, 94, 868, "small")
c.showPage(); c.save()
print(str(OUTPUT))
