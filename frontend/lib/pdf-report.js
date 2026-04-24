"use client";

/**
 * Capture a rendered chat message (including charts) and save it as a PDF.
 */
export async function exportMessageAsPdf({
  element,
  fileName = "chefbot-report.pdf",
  title = "ChefBot Report",
}) {
  if (!element) throw new Error("No report element found for PDF export.");

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#0f172a",
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Header
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(title, 14, 14);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, 14, 20);

  const margin = 10;
  const yOffset = 24;
  const usableWidth = pageWidth - margin * 2;

  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let remainingHeight = imgHeight;
  let positionY = yOffset;

  pdf.addImage(imgData, "PNG", margin, positionY, imgWidth, imgHeight);
  remainingHeight -= pageHeight - yOffset;

  while (remainingHeight > 0) {
    pdf.addPage();
    positionY = remainingHeight - imgHeight + margin;
    pdf.addImage(imgData, "PNG", margin, positionY, imgWidth, imgHeight);
    remainingHeight -= pageHeight - margin;
  }

  pdf.save(fileName);
}
