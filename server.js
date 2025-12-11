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
        const { csvData, originalData: requestOriginalData } = req.body;
        
        if (!csvData || !Array.isArray(csvData)) {
            return res.status(400).json({ error: 'CSV verisi bulunamadı' });
        }

        const dataToCompare = requestOriginalData || originalData;

        if (!dataToCompare || dataToCompare.length === 0) {
            return res.status(400).json({ error: 'Önce JSON verisini yüklemelisiniz' });
        }

        const comparisonResults = [];

        csvData.forEach(csvRow => {
            const original = dataToCompare.find(item => 
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

                const curlWithVerbose = modifiedCurl.replace(/^curl/, 'curl -w "\\nHTTP_STATUS:%{http_code}"');
                
                const { stdout, stderr } = await execPromise(curlWithVerbose, {
                    shell: '/bin/bash',
                    maxBuffer: 1024 * 1024
                });

                let status = 'success';
                let message = 'Başarılı';
                let statusCode = 200;
                
                const statusMatch = stdout.match(/HTTP_STATUS:(\d+)/);
                if (statusMatch) {
                    statusCode = parseInt(statusMatch[1]);
                    if (statusCode >= 200 && statusCode < 300) {
                        status = 'success';
                        message = `Status: ${statusCode} - Başarılı`;
                    } else {
                        status = 'error';
                        message = `Status: ${statusCode} - Hata`;
                    }
                } else if (stderr && !stdout) {
                    status = 'error';
                    statusCode = 500;
                    message = `Status: ${statusCode} - Hata: ${stderr.substring(0, 50)}`;
                }

                results.push({
                    countryCode: row.countryCode,
                    id: row.id,
                    status: status,
                    statusCode: statusCode,
                    message: message
                });
            } catch (error) {
                const errorMessage = error.message || 'Bilinmeyen hata';
                const isSuccess = errorMessage.includes('200') || 
                                 errorMessage.includes('201') || 
                                 errorMessage.includes('"data"');
                
                let statusCode = 500;
                const statusMatch = errorMessage.match(/(\d+)/);
                if (statusMatch) {
                    const code = parseInt(statusMatch[1]);
                    if (code >= 100 && code < 600) {
                        statusCode = code;
                    }
                }
                
                results.push({
                    countryCode: row.countryCode,
                    id: row.id,
                    status: isSuccess ? 'success' : 'error',
                    statusCode: statusCode,
                    message: isSuccess ? `Status: ${statusCode} - Başarılı` : `Status: ${statusCode} - Hata: ${errorMessage.substring(0, 50)}`
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

app.post('/api/process-appinfo', (req, res) => {
    try {
        const jsonData = req.body.jsonData;
        
        if (!jsonData) {
            return res.status(400).json({ error: 'JSON verisi bulunamadı' });
        }

        const data = jsonData.data || [];
        const included = jsonData.included || [];
        
        if (!Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: 'JSON data array içermelidir' });
        }

        const prepareForSubmission = data.find(item => 
            item.attributes?.state === 'PREPARE_FOR_SUBMISSION'
        );

        if (!prepareForSubmission) {
            return res.status(400).json({ error: 'PREPARE_FOR_SUBMISSION state bulunamadı' });
        }

        const appInfoLocalizationIds = prepareForSubmission.relationships?.appInfoLocalizations?.data || [];
        
        const localizationIds = appInfoLocalizationIds.map(item => item.id);

        const appInfoLocalizations = included.filter(item => 
            item.type === 'appInfoLocalizations' && localizationIds.includes(item.id)
        );

        const processedData = appInfoLocalizations.map(item => ({
            id: item.id,
            countryCode: item.attributes?.locale || 'N/A',
            name: item.attributes?.name || 'N/A',
            subtitle: item.attributes?.subtitle || 'N/A'
        }));

        res.json({ 
            success: true, 
            message: `${processedData.length} kayıt başarıyla işlendi`,
            data: processedData 
        });
    } catch (error) {
        res.status(500).json({ error: 'Bir hata oluştu: ' + error.message });
    }
});

app.post('/api/process-appinfo-with-state', (req, res) => {
    try {
        const { jsonData, selectedState } = req.body;
        
        if (!jsonData || !selectedState) {
            return res.status(400).json({ error: 'JSON verisi ve state gereklidir' });
        }

        const data = jsonData.data || [];
        const included = jsonData.included || [];
        
        if (!Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: 'JSON data array içermelidir' });
        }

        const selectedAppInfo = data.find(item => 
            item.attributes?.state === selectedState
        );

        if (!selectedAppInfo) {
            return res.status(400).json({ error: `${selectedState} state bulunamadı` });
        }

        const appInfoLocalizationIds = selectedAppInfo.relationships?.appInfoLocalizations?.data || [];
        
        const localizationIds = appInfoLocalizationIds.map(item => item.id);

        const appInfoLocalizations = included.filter(item => 
            item.type === 'appInfoLocalizations' && localizationIds.includes(item.id)
        );

        const processedData = appInfoLocalizations.map(item => ({
            id: item.id,
            countryCode: item.attributes?.locale || 'N/A',
            name: item.attributes?.name || 'N/A',
            subtitle: item.attributes?.subtitle || 'N/A'
        }));

        res.json({ 
            success: true, 
            message: `${processedData.length} kayıt başarıyla işlendi (${selectedState})`,
            data: processedData 
        });
    } catch (error) {
        res.status(500).json({ error: 'Bir hata oluştu: ' + error.message });
    }
});

app.post('/api/compare-csv-appinfo', (req, res) => {
    try {
        const { csvData, originalData } = req.body;
        
        if (!csvData || !Array.isArray(csvData)) {
            return res.status(400).json({ error: 'CSV verisi bulunamadı' });
        }

        if (!originalData || originalData.length === 0) {
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
                    name: csvRow.name,
                    subtitle: csvRow.subtitle,
                    nameChanged: original.name !== csvRow.name,
                    subtitleChanged: original.subtitle !== csvRow.subtitle
                };
                comparisonResults.push(changes);
            } else {
                comparisonResults.push({
                    id: csvRow.id,
                    countryCode: csvRow.countryCode,
                    name: csvRow.name,
                    subtitle: csvRow.subtitle,
                    nameChanged: true,
                    subtitleChanged: true,
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

app.post('/api/execute-curl-appinfo', async (req, res) => {
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

        const urlIdMatch = curlCommand.match(/appInfoLocalizations\/([a-f0-9-]+)/i);
        const urlOriginalId = urlIdMatch ? urlIdMatch[1] : originalId;

        for (const row of csvData) {
            try {
                const newDataObj = JSON.parse(originalDataRaw);
                
                if (newDataObj.data) {
                    newDataObj.data.id = row.id;
                    if (newDataObj.data.attributes) {
                        newDataObj.data.attributes.name = row.name;
                        newDataObj.data.attributes.subtitle = row.subtitle;
                    }
                }
                
                let modifiedCurl = curlCommand;
                
                if (urlOriginalId) {
                    modifiedCurl = modifiedCurl.replace(
                        new RegExp(`appInfoLocalizations/${urlOriginalId}`, 'g'),
                        `appInfoLocalizations/${row.id}`
                    );
                }
                
                modifiedCurl = modifiedCurl.replace(
                    /--data-raw\s+'[^']+'/,
                    `--data-raw '${JSON.stringify(newDataObj)}'`
                );

                console.log(`\n🔄 Ülke: ${row.countryCode} - ID: ${row.id}`);
                console.log(`📝 Name: ${row.name}`);
                console.log(`📝 Subtitle: ${row.subtitle}`);

                const curlWithVerbose = modifiedCurl.replace(/^curl/, 'curl -w "\\nHTTP_STATUS:%{http_code}"');
                
                const { stdout, stderr } = await execPromise(curlWithVerbose, {
                    shell: '/bin/bash',
                    maxBuffer: 1024 * 1024
                });

                let status = 'success';
                let message = 'Başarılı';
                let statusCode = 200;
                
                const statusMatch = stdout.match(/HTTP_STATUS:(\d+)/);
                if (statusMatch) {
                    statusCode = parseInt(statusMatch[1]);
                    if (statusCode >= 200 && statusCode < 300) {
                        status = 'success';
                        message = `Status: ${statusCode} - Başarılı`;
                    } else {
                        status = 'error';
                        message = `Status: ${statusCode} - Hata`;
                    }
                } else if (stderr && !stdout) {
                    status = 'error';
                    statusCode = 500;
                    message = `Status: ${statusCode} - Hata: ${stderr.substring(0, 50)}`;
                }

                results.push({
                    countryCode: row.countryCode,
                    id: row.id,
                    status: status,
                    statusCode: statusCode,
                    message: message
                });
            } catch (error) {
                const errorMessage = error.message || 'Bilinmeyen hata';
                const isSuccess = errorMessage.includes('200') || 
                                 errorMessage.includes('201') || 
                                 errorMessage.includes('"data"');
                
                let statusCode = 500;
                const statusMatch = errorMessage.match(/(\d+)/);
                if (statusMatch) {
                    const code = parseInt(statusMatch[1]);
                    if (code >= 100 && code < 600) {
                        statusCode = code;
                    }
                }
                
                results.push({
                    countryCode: row.countryCode,
                    id: row.id,
                    status: isSuccess ? 'success' : 'error',
                    statusCode: statusCode,
                    message: isSuccess ? `Status: ${statusCode} - Başarılı` : `Status: ${statusCode} - Hata: ${errorMessage.substring(0, 50)}`
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

