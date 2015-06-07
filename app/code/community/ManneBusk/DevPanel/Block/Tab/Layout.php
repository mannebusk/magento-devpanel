<?php
/**
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Block_Tab_Layout
    extends ManneBusk_DevPanel_Block_Tab
{
    /**
     * Get info about all blocks
     *
     * @return array
     */
    public function getBlockInfo()
    {
        $blocks = $this->getLayout()->getAllBlocks();
        $result = array();

        foreach ($blocks as $block) {
            $info = array(
                'name'          => $block->getNameInLayout(),
                'class'         => get_class($block),
                'alias'         => $block->getBlockAlias(),
            );

            if ($block instanceof Mage_Core_Block_Template) {
                $info = array_merge(
                        $info,
                        array(
                            'template'  => $block->getTemplate(),
                            'package'   => $this->_getPackageName($block->getTemplate()
                        )
                    )
                );
            }

            $result[] = new Varien_Object($info);
        }

        return $result;
    }

    /**
     * Retrieves the used package for a single template file.
     *
     * @param  string $filename
     *
     * @return string
     */
    protected function _getPackageName($filename)
    {
        return Mage::getSingleton('devpanel/package')
            ->getFilePackage($filename, array('_type' => 'template'));
    }
}
