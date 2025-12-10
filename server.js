import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

let originalData = [];

app.post('/api/process-json', (req, res) => {
    try {
        const jsonData = req.body.jsonData;
        
        if (!jsonData) {
            return res.status(400).json({ error: 'JSON verisi bulunamadı' });
        }

        const data = jsonData.data || jsonData;
        
        if (!Array.isArray(data)) {
            return res.status(400).json({ error: 'JSON verisi bir array içermelidir' });
        }

        const processedData = data.map(item => ({
            id: item.id,
            countryCode: item.attributes?.locale || 'N/A',
            description: item.attributes?.description || 'N/A',
            keywords: item.attributes?.keywords || 'N/A'
        }));

        originalData = processedData;

        res.json({ 
            success: true, 
            message: `${processedData.length} kayıt başarıyla işlendi`,
            data: processedData 
        });
    } catch (error) {
        res.status(500).json({ error: 'Bir hata oluştu: ' + error.message });
    }
});

app.post('/api/compare-csv', (req, res) => {
    try {
        const csvData = req.body.csvData;
        
        if (!csvData || !Array.isArray(csvData)) {
            return res.status(400).json({ error: 'CSV verisi bulunamadı' });
        }

        if (originalData.length === 0) {
            return res.status(400).json({ error: 'Önce JSON verisini yüklemelisiniz' });
        }

        const comparisonResults = [];

        csvData.forEach(csvRow => {
            const original = originalData.find(item => 
                item.id === csvRow.id && item.countryCode === csvRow.countryCode
            );

            if (original) {
                const changes = {
                    id: csvRow.id,
                    countryCode: csvRow.countryCode,
                    keywords: csvRow.keywords,
                    keywordsChanged: original.keywords !== csvRow.keywords
                };
                comparisonResults.push(changes);
            } else {
                comparisonResults.push({
                    id: csvRow.id,
                    countryCode: csvRow.countryCode,
                    keywords: csvRow.keywords,
                    keywordsChanged: true,
                    isNew: true
                });
            }
        });

        res.json({ 
            success: true, 
            message: `${comparisonResults.length} kayıt karşılaştırıldı`,
            data: comparisonResults 
        });
    } catch (error) {
        res.status(500).json({ error: 'Bir hata oluştu: ' + error.message });
    }
});

app.post('/api/execute-curl', async (req, res) => {
    try {
        const { curlCommand, csvData } = req.body;
        
        if (!curlCommand || !csvData) {
            return res.status(400).json({ error: 'Curl komutu ve CSV verisi gereklidir' });
        }

        const results = [];

        const dataRawMatch = curlCommand.match(/--data-raw\s+'([^']+)'/);
        if (!dataRawMatch) {
            return res.status(400).json({ error: 'Curl komutunda --data-raw bulunamadı' });
        }

        const originalDataRaw = dataRawMatch[1];
        const dataObj = JSON.parse(originalDataRaw);
        const originalId = dataObj.data?.id;

        const urlIdMatch = curlCommand.match(/appStoreVersionLocalizations\/([a-f0-9-]+)/i);
        const urlOriginalId = urlIdMatch ? urlIdMatch[1] : originalId;

        for (const row of csvData) {
            try {
                const newDataObj = JSON.parse(originalDataRaw);
                
                if (newDataObj.data) {
                    newDataObj.data.id = row.id;
                    if (newDataObj.data.attributes) {
                        newDataObj.data.attributes.keywords = row.keywords;
                    }
                }
                
                let modifiedCurl = curlCommand;
                
                if (urlOriginalId) {
                    modifiedCurl = modifiedCurl.replace(
                        new RegExp(`appStoreVersionLocalizations/${urlOriginalId}`, 'g'),
                        `appStoreVersionLocalizations/${row.id}`
                    );
                }
                
                modifiedCurl = modifiedCurl.replace(
                    /--data-raw\s+'[^']+'/,
                    `--data-raw '${JSON.stringify(newDataObj)}'`
                );

                console.log(`\n🔄 Ülke: ${row.countryCode} - ID: ${row.id}`);
                console.log(`📝 Keywords: ${row.keywords.substring(0, 50)}...`);

                const { stdout, stderr } = await execPromise(modifiedCurl, {
                    shell: '/bin/bash',
                    maxBuffer: 1024 * 1024
                });

                let status = 'success';
                let message = 'Başarılı';
                
                if (stderr && !stdout) {
                    status = 'error';
                    message = `Hata: ${stderr.substring(0, 100)}`;
                }

                results.push({
                    countryCode: row.countryCode,
                    id: row.id,
                    status: status,
                    message: message
                });
            } catch (error) {
                const errorMessage = error.message || 'Bilinmeyen hata';
                const isSuccess = errorMessage.includes('200') || 
                                 errorMessage.includes('201') || 
                                 errorMessage.includes('"data"');
                
                results.push({
                    countryCode: row.countryCode,
                    id: row.id,
                    status: isSuccess ? 'success' : 'error',
                    message: isSuccess ? 'Başarılı' : `Hata: ${errorMessage.substring(0, 100)}`
                });
            }
        }

        res.json({ 
            success: true, 
            message: 'Tüm istekler tamamlandı',
            results 
        });
    } catch (error) {
        res.status(500).json({ error: 'Bir hata oluştu: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});

