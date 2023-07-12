const IDB_URL = 'indexeddb://';

class mlTools {
    constructor() {
        this.init();
    }

    init() {
        console.log('run init');
        this.canvas;
        this.context;
        this.data = new Map();
        this.threshold = this.t = 120;
        this.radius = 30;
        this.mode = 0;
        this.model = 0;
        this.modelLoaded = false;
        this.size = 0;
        this.ch = 4;
        this.undo;
        this.temp = document.createElement('canvas');
        this.fullPredict = document.createElement('canvas');
    }

    initcanvas(canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext('2d');
    }

    /**
     * 
     * @param {*} x1 
     * @param {*} y1 
     * @param {*} w 
     * @param {*} h 
     * @param {*} th 
     * @returns 
     */
    detectContours(x1, y1, w, h, th, size, iter, context = this.context, invert = true) {
        const imgCanvasData = context.getImageData(x1, y1, w, h);
        let img = cv.matFromImageData(imgCanvasData);

        // Convert the image to grayscale
        let gray = new cv.Mat();
        cv.cvtColor(img, gray, cv.COLOR_RGBA2GRAY);

        let thresholdImg1 = new cv.Mat();
        cv.threshold(gray, thresholdImg1, th, 255, cv.THRESH_BINARY)
        const sureFgImg1 = this.thresholdImgToForegroundImg(thresholdImg1, size, iter, 2);
        this.showmatImg(sureFgImg1, document.querySelector('.processed-image-container'));
        let contours1 = new cv.MatVector();
        let hierarchy1 = new cv.Mat();
        cv.findContours(sureFgImg1, contours1, hierarchy1, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        if (invert) {
            let thresholdImg2 = new cv.Mat();
            cv.threshold(gray, thresholdImg2, th, 255, cv.THRESH_BINARY_INV)
            const sureFgImg2 = this.thresholdImgToForegroundImg(thresholdImg2, size, iter, 2);
            let contours2 = new cv.MatVector();
            let hierarchy2 = new cv.Mat();
            cv.findContours(sureFgImg2, contours2, hierarchy2, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            return [contours1, contours2]
        }

        return [contours1];
    }

    thresholdImgToForegroundImg(thresholdImg, erode_size = 2, iteration = 1, kernel_size = 3) {
        // Perform morphological operations to enhance separation
        const kernel = new cv.Mat();
        cv.Mat.ones(kernel_size, kernel_size, cv.CV_8U).copyTo(kernel);
        const opening = new cv.Mat();
        cv.morphologyEx(thresholdImg, opening, cv.MORPH_OPEN, kernel);
        const morph = new cv.Mat();
        cv.morphologyEx(opening, morph, cv.MORPH_CLOSE, kernel);
        const erode = new cv.Mat();
        const erode_kernel = new cv.Mat();
        cv.Mat.ones(erode_size, erode_size, cv.CV_8U).copyTo(erode_kernel);
        cv.erode(morph, erode, erode_kernel, new cv.Point(-1,-1), iteration)
        return erode;
    }

    /**
     * Compute the overlap area between contour and polygon
     * @param contour {number[][]} openCV contour data
     * @param polygon {number[][]} polygon data
     * @return {number} overlap area
     */
    overlapArea(contour, polygon) {
        const contour2 = contour.slice();
        const polygon2 = polygon.slice();
        contour2.push(contour2[0]);
        polygon2.push(polygon2[0]);
        const contourTurf = turf.polygon([contour2]);
        const polygonTurf = turf.polygon([polygon2]);
        const intersection = turf.intersect(contourTurf, polygonTurf);
      
        if (!intersection) {
            return 0.0;
        }
        
        return turf.area(intersection);
    }

    /**
     * Convert contour data into array
     * @param contour {any} openCV contour data
     * @return {number[][]} contour data array
     */
    convertToArray(contour) {
        const contourData = contour.data32S;
        let contourPoints = [];
        for (let j = 0; j<contourData.length-1; j+=2) {
            contourPoints.push([contourData[j], contourData[j+1]]);
        }
        return contourPoints;
    }

    /**
     * Find the most fit contour with polygon data
     * @param contours {any} openCV contours data
     * @param polygon {number[][]} polygon data
     * @param w {number} width of original image
     * @param h {number} height of orignal image
     * @return {number[][]} the most fit contour data array
     */
    mostFitContour(contours, polygon, expansionBound, erode_size = 2, iteration = 1) {
        let maxArea = 0;
        let area;
        let fitContour;
        let expandedContour;
        for (let j = 0; j < contours.length; j++) {
            for (let i = 0; i < contours[j].size(); i++) {
                let contour = contours[j].get(i);
                if (cv.contourArea(contour, false) < 1) {
                    continue;
                }
                const contourArray = this.convertToArray(contour);
                if (this.closeBoundary(contourArray, expansionBound, 3)) {
                    continue;
                }
                area = this.overlapArea(contourArray, polygon);
                if (area > maxArea) {
                    maxArea = area;
                    fitContour = contour;
                }
            }
        }

        if (fitContour) {
            expandedContour = this.expandContour(fitContour, expansionBound.w, expansionBound.h, erode_size, iteration);
        }
        if (!expandedContour) {
            return [];
        }
        const fit_contour = this.convertToArray(expandedContour);
        return fit_contour;
    }

    expandContour(contour, width, height, size, iter) {
        const mask = new cv.Mat.zeros(height, width, cv.CV_8UC1);
        for (let i = 0; i < width; i++) {
            for (let j = 0; j < height; j++) {
                const point = new cv.Point(i, j);
                if (cv.pointPolygonTest(contour, point, false) >= 0) {
                    mask.data[(point.y * mask.cols + point.x)] = 255;
                }
            }
        }

        const erode_kernel = new cv.Mat();
        cv.Mat.ones(size, size, cv.CV_8U).copyTo(erode_kernel);

        const dilate = new cv.Mat();
        cv.dilate(mask, dilate, erode_kernel, new cv.Point(-1,-1), iter);
        this.showmatImg(dilate, document.querySelector('.processed-image-container'));

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(dilate, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        if (contours.size() === 1) {
            return contours.get(0);
        }
        return null;
    }

    /**
     * Determine whether one point close to its boundary
     * @param {number[][]} contour 
     * @param {any} expansionBound 
     * @param {number} epsilon 
     * @returns {boolean}
     */
    closeBoundary(contour, expansionBound, epsilon) {
        let close = false;
        for (let i = 0; i < contour.length; i++) {
            if (contour[i][0] <= epsilon
            || contour[i][0] >= expansionBound.w - epsilon
            || contour[i][1] <= epsilon
            || contour[i][1] >= expansionBound.h - epsilon) {
                close = true;
                break;
            }
        }
        return close;
    }

    /**
     * Get coordinate parameter of polygon boundary
     * @param {number[][]} polygon
     * @return {any} {x: left, y: top, w: width, h: height} 
     */
    getCoordinate(polygon) {
        let x1 = polygon[0][0];
        let y1 = polygon[0][1];
        let x2 = polygon[0][0];
        let y2 = polygon[0][1];

        for (let i = 0; i < polygon.length; i++) {
            if (x1 > polygon[i][0]) {
                x1 = polygon[i][0];
            }
            if (y1 > polygon[i][1]) {
                y1 = polygon[i][1];
            }
            if (x2 < polygon[i][0]) {
                x2 = polygon[i][0];
            }
            if (y2 < polygon[i][1]) {
                y2 = polygon[i][1];
            }
        }
        return {
            x: x1,
            y: y1,
            w: x2 - x1,
            h: y2 - y1,
        }
    }

    /**
     * Return boundary information with expansion value
     * @param {any} originalBound
     * @param {number} expansionValue
     */
    getExpansionCoordicate(originalBound, expansionValue) {
        return {
            x: ~~(originalBound.x - originalBound.w * expansionValue/(100 * 2)),
            y: ~~(originalBound.y - originalBound.h * expansionValue/(100 * 2)),
            w: ~~(originalBound.w * (1 + expansionValue/100)),
            h: ~~(originalBound.h * (1 + expansionValue/100)),
        }
    }

    /**
     * Realign position of polygon like array
     * @param {number[][]} array - input array
     * @param {number} x - left position of new coordinate
     * @param {number} y - top position of new coordinate
     * @return {number[][]} processed array
     */
    reAlign(array, x, y) {
        if (array === undefined) {
            return [];
        }
        for (let i = 0; i < array.length; i++) {
            array[i][0] -= x;
            array[i][1] -= y;
        }
        return array;
    }

    /**
     * Process drawing polygon without using any model
     * @param polygon {number[][]} drawing polygon data
     * @param threshold {number} threshold for edge detection
     * @param expansion {number} expansion percentage from existing data
     * @return {number[][]} processed polygon
     */
    applyDrawNoModel(polygon, threshold, expansion, kernel_size, iteration) {
        // remove last point from the polygon
        polygon.pop();

        // get current polygon coordinate (left, top, width, height)
        const polygonBound = this.getCoordinate(polygon);

        // get expansion coordinate (left, top, width, height)
        const expansionBound = this.getExpansionCoordicate(polygonBound, expansion);

        // get contours from detect edges image
        const contours = this.detectContours(expansionBound.x, expansionBound.y, expansionBound.w, expansionBound.h, threshold, kernel_size, iteration);

        // re-align polygon origin
        polygon = this.reAlign(polygon, expansionBound.x, expansionBound.y);

        // get most fit contour
        let fitContour = this.mostFitContour(contours, polygon, expansionBound, kernel_size, iteration);

        // re-align the most fit contour
        fitContour = this.reAlign(fitContour, -expansionBound.x, -expansionBound.y);

        if (fitContour.length === 0) {
            return [];
        }
        // add last point into the most fit contour
        fitContour.push(fitContour[0]);
        
        return fitContour;
    }

    /**
     * Load model when annotation have been enable
     * @param {string} key - model key
     * @return {Promise<boolean>}
     */
    loadModel(key) {
        if (key === 'watershed') {
            this.model = 'watershed';
            return Promise.resolve(true);
        }
        return new Promise((resolve, reject) => {
            try {
                if (this.model) {
                    this.model.dispose();
                }
                const tx = db.transaction('models_store', 'readonly');
                const store = tx.objectStore('models_store');
                const req = store.get(key);
        
                req.onsuccess = async function(e) {
                    // self.showProgress('Loading model...');
        
                    // Keras sorts the labels by alphabetical order.
                    const inputShape = e.target.result.input_shape;
                    console.log('inputShape: ', inputShape);
                    this.size = parseInt(inputShape[1]);
                    this.ch =  parseInt(inputShape[3]);
              
                    this.model = await tf.loadLayersModel(IDB_URL + key);
                    console.log('Model Loaded');
                    const memory = tf.memory();
                    console.log('Model Memory Usage');
                    console.log('GPU : ' + memory.numBytesInGPU + ' bytes');
                    console.log('Total : ' + memory.numBytes + ' bytes');
              
                    // tfvis.show.modelSummary({name: 'Model Summary', tab: 'Model Inspection'}, model);
                    tf.tidy(()=>{
                        // Warmup the model before using real data.
                        this.model.predict(tf.zeros([1, this.size, this.size, this.ch]));
                        //   self.showProgress('Model loaded...');
                        resolve(true)
                    });
                }.bind(this)
            } catch (error) {
                console.log('fail to load model: ', error);
                reject(false);
            }
        })
    }

    /**
     * Make 
     * @param {any} img tensorflow data
     * @param {number} ch - number of channel process by model (gray: 1, rgb: 4)
     * @return {any} - process image data
     */
    channelProcessing(img, ch=1) {
        if (ch == 1) {
            return tf.image.resizeBilinear(img, [imageSize, imageSize]).mean(2);
        } else {
            return tf.image.resizeBilinear(img, [imageSize, imageSize]);
        }
    }

    /**
     * Scaling processing for model input images
     * @param {any} img - image tensorflow data
     * @param {string} scaleMethod - model scaling method
     * @return {any} - scaled image data
     */
    pixelScaling(img, scaleMethod) {
        if (scaleMethod == 'no_scale') {
            return img
        } else if (scaleMethod == 'norm') {
        // Pixel Normalization: scale pixel values to the range 0-1.
            const scale = tf.scalar(255);
            return img.div(scale);
        } else if (scaleMethod == 'center') {
        // Pixel Centering: scale pixel values to have a zero mean.
            const mean = img.mean();
            return img.sub(mean);
        } else {
        // Pixel Standardization: scale pixel values to have a zero mean and unit variance.
            const mean = img.mean();
            const std = (img.squaredDifference(mean).sum()).div(img.flatten().shape).sqrt();
            return img.sub(mean).div(std);
        }
    }

    /**
     * Get expansion coordinate parameter coresponding with using model
     * @param {number} step - current model input size px
     * @param {any} polygonBound - current polygon boundary parameter
     * @param {number} expansionValue - choosen expansion value
     * @return {any} expansion boundary parameter
     */
    getModelExpansionCoordicate(step, polygonBound, expansionValue) {
        const extendX = Math.ceil(polygonBound.w *  (1 + expansionValue / 100) / step) * step - polygonBound.w;
        const extendY = Math.ceil(polygonBound.h *  (1 + expansionValue / 100) / step) * step - polygonBound.h;
        return {
            x: polygonBound.x - ~~(extendX/2),
            y: polygonBound.y - ~~(extendY/2),
            w: polygonBound.w + extendX,
            h: polygonBound.h + extendY,
        }
    }

    /**
     * Get list of coordinates
     * @param {number} step - model input size
     * @param {any} expansionBound - expansion boundary parameter
     * @return {any[]} - list of grid pieces coordinates
     */
    getGridCoordinate(step, expansionBound) {
        const numStepX = ~~(expansionBound.w / step);
        const numStepY = ~~(expansionBound.h / step);
        let gridBounds = [];
        for (let i = 0; i < numStepX; i++) {
            for (let j = 0; j < numStepY; j++) {
                gridBounds.push({
                    x: expansionBound.x + i * step,
                    y: expansionBound.y + j * step,
                    w: step,
                    h: step,
                })
            }
        }
        return gridBounds;
    }

    /**
     * Using imported model for autocorrect user draw polygon
     * @param {any} model - processing model
     * @param {number} size - model input image size px
     * @param {number} ch - model input channel
     * @param {string} scaleMethod - model scale method
     * @param {number[][]} polygon - user draw polygon data (already align)
     * @param {number} threshold - upper threshold value for canny detection
     * @param {number} expansion - expansion percentage
     */
    async applyDrawModel(model, size, ch, scaleMethod, polygon, threshold, expansion, kernel_size, iteration) {
        // remove last point from the polygon
        polygon.pop();

        // get current polygon coordinate (left, top, width, height)
        const polygonBound = this.getCoordinate(polygon);

        // get expansion coordinate (left, top, width, height)
        const expansionBound = this.getModelExpansionCoordicate(size, polygonBound, expansion);

        // get grid coordinate with grid size is model size
        const gridBounds = this.getGridCoordinate(size, expansionBound);

        // loop over all pieces of image and run the model
        this.fullPredict.getContext('2d').clearRect(0, 0, this.fullPredict.width, this.fullPredict.height);
        this.fullPredict.width = expansionBound.w;
        this.fullPredict.height = expansionBound.h;
        for (let i = 0; i < gridBounds.length; i++) {
            // get image data
            const imgCanvasData = this.context.getImageData(gridBounds[i].x, gridBounds[i].y, size, size);
            let val;
            tf.tidy(() => {
                const img = tf.browser.fromPixels(imgCanvasData).toFloat();
                let img2;
                if (ch == 1) {
                    img2 = tf.image.resizeBilinear(img, [size, size]).mean(2);
                } else {
                    img2 = tf.image.resizeBilinear(img, [size, size]);
                }
                let normalized;
                if (scaleMethod == 'norm') {
                    const scale = tf.scalar(255);
                    normalized = img2.div(scale);
                } else if (scaleMethod == 'center') {
                    const mean = img2.mean();
                    normalized = img2.sub(mean);
                } else if (scaleMethod == 'std') {
                    const mean = img2.mean();
                    const std = (img2.squaredDifference(mean).sum()).div(img2.flatten().shape).sqrt();
                    normalized = img2.sub(mean).div(std);
                } else {
                    normalized = img2;
                }
                const batched = normalized.reshape([1, size, size, ch]);
                let values = model.predict(batched).dataSync();
                values = Array.from(values);
                // scale values
                values = values.map((x) => x * 255);
                val = [];
                while (values.length > 0) val.push(values.splice(0, size));
                const padding = 2;
                val = this.fillBoundary(val, padding);
            })
            tf.engine().startScope();
            await tf.browser.toPixels(val, this.temp);
            this.fullPredict.getContext('2d').drawImage(this.temp, gridBounds[i].x - expansionBound.x, gridBounds[i].y - expansionBound.y);
            tf.engine().endScope();
        }

        const fullPredictCanvas = this.fullPredict.getContext('2d');

        // get contours from detect edges image
        const contours = this.detectContours(0, 0, this.fullPredict.width, this.fullPredict.height, threshold, kernel_size, iteration, fullPredictCanvas, false);

        this.showCanvas(this.fullPredict, document.querySelector('.model-predict-image-container'));

        // re-align polygon origin
        polygon = this.reAlign(polygon, expansionBound.x, expansionBound.y);

        // get most fit contour
        let fitContour = this.mostFitContour(contours, polygon, expansionBound, kernel_size, iteration);

        // re-align the most fit contour
        fitContour = this.reAlign(fitContour, -expansionBound.x, -expansionBound.y);

        if (fitContour.length === 0) {
            return [];
        }
        // add last point into the most fit contour
        fitContour.push(fitContour[0]);

        return fitContour;
    }

    async applyDraw(polygon, threshold, expansion, kernel_size, iteration, scaleMethod = 'no_scale') {
        if (this.model && this.model !== 'watershed') {
            return await this.applyDrawModel(this.model, this.size, this.ch, scaleMethod, polygon, threshold, expansion, kernel_size, iteration);
        } else {
            return this.applyDrawNoModel(polygon, threshold, expansion, kernel_size, iteration)
        }
    }

    fillBoundary(imageArray, padding) {
        const size = imageArray.length;
        for (let i = 0; i < padding; i++) {
            for (let j = padding; j<size-padding; j++) {
                imageArray[i][j] = imageArray[padding][j];
                imageArray[size-i-1][j] = imageArray[size-padding-1][j];
                imageArray[j][i] = imageArray[j][padding];
                imageArray[j][size-i-1] = imageArray[j][size-padding-1];
            }
        }
        for (let i = 0; i < padding; i++) {
            for (let j = 0; j < padding; j++) {
                imageArray[i][j] = imageArray[padding][padding];
                imageArray[size-i-1][j] = imageArray[size-padding-1][padding];
                imageArray[i][size-j-1] = imageArray[padding][size-padding-1];
                imageArray[size-i-1][size-j-1] = imageArray[size-padding-1][size-padding-1];
            }
        }
        return imageArray;
    }

    showmatImg(edges, elt, convertCh = true) {
        // Create a new canvas for displaying the edges
        empty(elt)
        var edgesCanvas = document.createElement('canvas');
        edgesCanvas.width = edges.cols;
        edgesCanvas.height = edges.rows;
        var edgesCtx = edgesCanvas.getContext('2d');
        let data = []
        if (convertCh) {
            for (let i = 0; i < edges.data.length; i++) {
                data.push(edges.data[i]);
                data.push(edges.data[i]);
                data.push(edges.data[i]);
                data.push(255);
            }
        }

        // Convert the edges data to an image
        var edgesData = new ImageData(
            new Uint8ClampedArray(data),
            edges.cols,
            edges.rows
        );

        // Draw the edges on the canvas
        edgesCtx.putImageData(edgesData, 0, 0);
        if ((edgesCanvas.height/edgesCanvas.width) > (elt.offsetHeight/elt.offsetWidth)) {
            edgesCanvas.style.height = '100%';
            edgesCanvas.style.width = '';
        } else {
            edgesCanvas.style.width = '100%';
            edgesCanvas.style.height = '';
        }
        // Append the canvas to the document body or any other container
        elt.appendChild(edgesCanvas);
    }

    showCanvas(canvas, elt) {
        empty(elt);
        if ((canvas.height/canvas.width) > (elt.offsetHeight/elt.offsetWidth)) {
            canvas.style.height = '100%';
            canvas.style.width = '';
        } else {
            canvas.style.width = '100%';
            canvas.style.height = '';
        }
        elt.appendChild(canvas);
    }
}

var mltools = new mlTools();