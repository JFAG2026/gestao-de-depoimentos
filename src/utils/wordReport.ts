import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType } from 'docx';
import { saveAs } from 'file-saver';
import { AnalyzedDocument } from '../types';

export const generateWordReport = async (documents: AnalyzedDocument[]) => {
  // Sort documents alphabetically by personName
  const sortedDocs = [...documents].sort((a, b) => a.personName.localeCompare(b.personName));

  const sections = sortedDocs.map(doc => {
    const children: any[] = [
      // Header Table for metadata
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0 },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: "E5E7EB" },
          left: { style: BorderStyle.NONE, size: 0 },
          right: { style: BorderStyle.NONE, size: 0 },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: "F9FAFB", type: ShadingType.CLEAR },
                margins: { top: 200, bottom: 200, left: 200, right: 200 },
                children: [
                  new Paragraph({
                    spacing: { before: 0, after: 0 },
                    children: [
                      new TextRun({
                        text: doc.personName.toUpperCase(),
                        bold: true,
                        size: 28,
                        color: "111827",
                      }),
                    ],
                  }),
                  new Paragraph({
                    spacing: { before: 0, after: 0 },
                    children: [
                      new TextRun({
                        text: `${doc.date} • ${doc.phase?.toUpperCase() || 'INQUÉRITO'} • Presidido por ${doc.presidingEntity}`,
                        size: 20,
                        color: "6B7280",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ text: "", spacing: { before: 0, after: 0 } }),
    ];

    // Add Topics
    if (doc.topics && doc.topics.length > 0) {
      doc.topics.forEach(topic => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `● ${topic.topic}`,
                bold: true,
                size: 24,
                color: "111827",
              }),
            ],
          }),
          new Paragraph({
            indent: { firstLine: 567 },
            children: [
              new TextRun({
                text: topic.description,
              }),
            ],
          })
        );

        if (topic.quote) {
          children.push(
            new Paragraph({
              indent: { left: 567 },
              children: [
                new TextRun({
                  text: `"${topic.quote}"`,
                  italics: true,
                  color: "6B7280",
                  size: 18,
                }),
              ],
            })
          );
        }
        
        children.push(new Paragraph({ text: "", spacing: { before: 100, after: 100 } }));
      });
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "Sem análise IA disponível para este documento.",
              italics: true,
              color: "9CA3AF",
            }),
          ],
        })
      );
    }

    // Page break or spacing between documents
    children.push(new Paragraph({ text: "", spacing: { before: 400, after: 400 } }));
    
    return children;
  }).flat();

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri Light",
            size: 22,
            color: "374151",
          },
          paragraph: {
            alignment: AlignmentType.JUSTIFIED,
            spacing: { line: 360, before: 0, after: 0 },
          },
        },
      },
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: "RELATÓRIO DE DEPOIMENTOS - JURISANALYZER",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          ...sections,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `Relatorio_JurisAnalyzer_${new Date().toISOString().split('T')[0]}.docx`);
};
